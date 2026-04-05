/**
 * arc secret — CLI commands for the encrypted secret store.
 *
 * Subcommands: set, get, list, delete
 * Input methods for set: interactive prompt (default), --from-stdin, --from-file <path>
 * Secret values never appear in process.argv.
 */
import fs from "node:fs";
import { SecretStore } from "@axiom-labs/arc-core";
import { error, success, info, warn } from "../display.js";

// ─── Module-level password cache (single session) ────────────────────

let cachedMasterPassword: string | null = null;

async function promptMasterPassword(): Promise<string> {
  if (cachedMasterPassword !== null) return cachedMasterPassword;

  try {
    const mod = await import("@inquirer/prompts");
    const pw = await mod.password({ message: "Master password:" });
    if (!pw) {
      error("No master password provided.");
      process.exit(1);
    }
    cachedMasterPassword = pw;
    return pw;
  } catch {
    error(
      "Interactive prompts not available (@inquirer/prompts not installed). Cannot read master password."
    );
    process.exit(1);
  }
}

function createStore(): SecretStore {
  return new SecretStore({
    getPassword: promptMasterPassword,
  });
}

// ─── Input helpers ───────────────────────────────────────────────────

async function readValueInteractive(): Promise<string> {
  try {
    const mod = await import("@inquirer/prompts");
    const value = await mod.password({ message: "Secret value:", mask: "*" });
    if (!value) {
      error("No secret value provided.");
      process.exit(1);
    }
    return value;
  } catch {
    error(
      "Interactive prompts not available (@inquirer/prompts not installed)."
    );
    process.exit(1);
  }
}

function readValueFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      const trimmed = data.trim();
      if (!trimmed) {
        error("No secret value received from stdin.");
        process.exit(1);
      }
      resolve(trimmed);
    });
    process.stdin.on("error", reject);
  });
}

function readValueFromFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    error(`File not found: ${filePath}`);
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, "utf-8").trim();
  if (!content) {
    error(`File is empty: ${filePath}`);
    process.exit(1);
  }
  return content;
}

// ─── Command handlers ────────────────────────────────────────────────

export async function handleSecretSet(
  name: string,
  opts: { fromStdin?: boolean; fromFile?: string }
): Promise<void> {
  let value: string;

  if (opts.fromFile) {
    value = readValueFromFile(opts.fromFile);
  } else if (opts.fromStdin || !process.stdin.isTTY) {
    value = await readValueFromStdin();
  } else {
    value = await readValueInteractive();
  }

  const store = createStore();
  try {
    await store.setSecret(name, value);
    success(`Secret "${name}" stored.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Failed to store secret "${name}": ${msg}`);
    process.exit(1);
  }
}

export async function handleSecretGet(
  name: string,
  opts: { quiet?: boolean }
): Promise<void> {
  const store = createStore();
  try {
    const value = await store.getSecret(name);
    if (value === null) {
      error(`Secret "${name}" not found.`);
      process.exit(1);
    }
    if (opts.quiet) {
      // Machine-readable: value only, no decoration
      process.stdout.write(value);
    } else {
      console.log(value);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Failed to retrieve secret "${name}": ${msg}`);
    process.exit(1);
  }
}

export async function handleSecretList(opts: { json?: boolean }): Promise<void> {
  const store = createStore();
  try {
    const secrets = await store.listSecrets();

    if (opts.json) {
      console.log(JSON.stringify(secrets, null, 2));
      return;
    }

    if (secrets.length === 0) {
      info("No secrets stored.");
      return;
    }

    // Print table header
    const nameWidth = Math.max(4, ...secrets.map((s) => s.name.length));
    const header = `  ${"Name".padEnd(nameWidth)}  ${"Created".padEnd(24)}  Updated`;
    const separator = `  ${"─".repeat(nameWidth)}  ${"─".repeat(24)}  ${"─".repeat(24)}`;

    console.log(header);
    console.log(separator);
    for (const s of secrets) {
      const created = new Date(s.createdAt).toLocaleString();
      const updated = new Date(s.updatedAt).toLocaleString();
      console.log(`  ${s.name.padEnd(nameWidth)}  ${created.padEnd(24)}  ${updated}`);
    }
    console.log();
    info(`${secrets.length} secret(s) total.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Failed to list secrets: ${msg}`);
    process.exit(1);
  }
}

export async function handleSecretDelete(
  name: string,
  opts: { force?: boolean }
): Promise<void> {
  // Confirmation unless --force
  if (!opts.force) {
    if (!process.stdin.isTTY) {
      error('Cannot confirm deletion in non-interactive mode. Use --force to skip confirmation.');
      process.exit(1);
    }
    try {
      const mod = await import("@inquirer/prompts");
      const confirmed = await mod.confirm({
        message: `Delete secret "${name}"?`,
        default: false,
      });
      if (!confirmed) {
        info("Cancelled.");
        return;
      }
    } catch {
      error("Interactive prompts not available. Use --force to skip confirmation.");
      process.exit(1);
    }
  }

  const store = createStore();
  try {
    const existed = await store.deleteSecret(name);
    if (existed) {
      success(`Secret "${name}" deleted.`);
    } else {
      warn(`Secret "${name}" not found (nothing to delete).`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Failed to delete secret "${name}": ${msg}`);
    process.exit(1);
  }
}
