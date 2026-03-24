import fs from "node:fs";
import path from "node:path";
import { getProfileDir } from "./paths.js";
import { warn } from "./display.js";

export const SERVICE_NAME = "arc";

interface KeyringEntry {
  setPassword(password: string): void;
  getPassword(): string;
  deletePassword(): void;
}

interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntry;
}

let keyringModule: KeyringModule | null = null;
let keyringChecked = false;

async function loadKeyring(): Promise<KeyringModule | null> {
  if (keyringChecked) {
    return keyringModule;
  }
  keyringChecked = true;
  try {
    const mod = (await import("@napi-rs/keyring")) as KeyringModule;
    keyringModule = mod;
    return mod;
  } catch {
    keyringModule = null;
    return null;
  }
}

export function isKeyringAvailable(): boolean {
  return keyringModule !== null;
}

function getFallbackPath(profileName: string): string {
  return path.join(getProfileDir(profileName), ".api-key");
}

function writeFallbackFile(filePath: string, secret: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, secret, { encoding: "utf-8", mode: 0o600 });
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o600);
  }
}

export async function storeSecret(
  profileName: string,
  secret: string
): Promise<void> {
  const kr = await loadKeyring();
  if (kr) {
    try {
      const entry = new kr.Entry(SERVICE_NAME, profileName);
      entry.setPassword(secret);
      return;
    } catch {
      warn(
        "Failed to store secret in OS keyring. Falling back to plaintext file."
      );
    }
  } else {
    warn(
      "OS keyring not available (@napi-rs/keyring not installed). Storing API key in plaintext file."
    );
  }

  try {
    const fallbackPath = getFallbackPath(profileName);
    writeFallbackFile(fallbackPath, secret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`Failed to store secret in fallback file: ${message}`);
  }
}

export async function retrieveSecret(
  profileName: string
): Promise<string | null> {
  const kr = await loadKeyring();
  if (kr) {
    try {
      const entry = new kr.Entry(SERVICE_NAME, profileName);
      const password = entry.getPassword();
      return password;
    } catch {
      // Entry not found or keyring error -- fall through to file fallback
    }
  }

  try {
    const fallbackPath = getFallbackPath(profileName);
    if (fs.existsSync(fallbackPath)) {
      return fs.readFileSync(fallbackPath, "utf-8");
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`Failed to read secret from fallback file: ${message}`);
  }

  return null;
}

export async function deleteSecret(profileName: string): Promise<void> {
  const kr = await loadKeyring();
  if (kr) {
    try {
      const entry = new kr.Entry(SERVICE_NAME, profileName);
      entry.deletePassword();
    } catch {
      // Entry may not exist -- ignore
    }
  }

  try {
    const fallbackPath = getFallbackPath(profileName);
    if (fs.existsSync(fallbackPath)) {
      fs.unlinkSync(fallbackPath);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`Failed to delete secret fallback file: ${message}`);
  }
}
