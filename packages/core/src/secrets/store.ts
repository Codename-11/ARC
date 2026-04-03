/**
 * SecretStore — high-level CRUD interface wrapping VaultEngine + audit logging.
 *
 * Each operation logs via writeLogEvent with component='secret'.
 * The master password is obtained via a caller-supplied callback and cached
 * for the lifetime of the SecretStore instance (single session).
 */
import fs from "node:fs";
import path from "node:path";
import { getArcDir } from "../paths.js";
import { writeLogEvent } from "../logging.js";
import { VaultEngine } from "./vault.js";
import type { SecretMetadata, SecretStoreOptions } from "./types.js";

// ─── Helpers ─────────────────────────────────────────────────────────

function defaultVaultPath(): string {
  return path.join(getArcDir(), "secrets", "vault.enc");
}

// ─── SecretStore class ───────────────────────────────────────────────

export class SecretStore {
  private options: SecretStoreOptions;
  private vaultPath: string;
  private cachedPassword: string | null = null;
  private engine: VaultEngine | null = null;

  constructor(options: SecretStoreOptions) {
    this.options = options;
    this.vaultPath = options.vaultPath ?? defaultVaultPath();
  }

  /** Get or prompt for the master password, caching for the session. */
  private async getPassword(): Promise<string> {
    if (this.cachedPassword !== null) return this.cachedPassword;
    this.cachedPassword = await this.options.getPassword();
    return this.cachedPassword;
  }

  /** Load or create the vault engine. */
  private async loadEngine(): Promise<VaultEngine> {
    if (this.engine) return this.engine;
    const pw = await this.getPassword();
    if (fs.existsSync(this.vaultPath)) {
      this.engine = await VaultEngine.open(this.vaultPath, pw);
    } else {
      this.engine = await VaultEngine.create(pw);
    }
    return this.engine;
  }

  /** Store a secret (creates or overwrites). */
  async setSecret(name: string, value: string): Promise<void> {
    const engine = await this.loadEngine();
    engine.encrypt(name, value);
    engine.save(this.vaultPath);

    writeLogEvent({
      level: "info",
      component: "secret",
      action: "set",
      message: `Secret '${name}' stored.`,
      profile: this.options.profile,
      data: { secretName: name },
    });
  }

  /** Retrieve a secret value by name. Returns null if not found. */
  async getSecret(name: string): Promise<string | null> {
    const engine = await this.loadEngine();
    const entry = engine.decrypt(name);

    writeLogEvent({
      level: "info",
      component: "secret",
      action: "get",
      message: entry ? `Secret '${name}' retrieved.` : `Secret '${name}' not found.`,
      profile: this.options.profile,
      data: { secretName: name, found: !!entry },
    });

    return entry?.value ?? null;
  }

  /** List metadata for all secrets (never returns values). */
  async listSecrets(): Promise<SecretMetadata[]> {
    const engine = await this.loadEngine();
    const secrets = engine.list();

    writeLogEvent({
      level: "info",
      component: "secret",
      action: "list",
      message: `Listed ${secrets.length} secret(s).`,
      profile: this.options.profile,
      data: { count: secrets.length },
    });

    return secrets;
  }

  /** Delete a secret by name. Returns true if it existed. */
  async deleteSecret(name: string): Promise<boolean> {
    const engine = await this.loadEngine();
    const existed = engine.delete(name);
    if (existed) {
      engine.save(this.vaultPath);
    }

    writeLogEvent({
      level: "info",
      component: "secret",
      action: "delete",
      message: existed
        ? `Secret '${name}' deleted.`
        : `Secret '${name}' not found (no-op delete).`,
      profile: this.options.profile,
      data: { secretName: name, existed },
    });

    return existed;
  }

  /** Reset cached password and engine (forces re-prompt on next operation). */
  reset(): void {
    this.cachedPassword = null;
    this.engine = null;
  }
}
