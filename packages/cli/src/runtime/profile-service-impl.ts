import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig } from "../config.js";
import { getProfileDir } from "../paths.js";
import type { AuthType } from "../types.js";
import { shouldCopyEntry, detectAuthType, describeEntry } from "../import-utils.js";
import { getAdapter } from "../adapters/index.js";
import { logEvent } from "../log.js";

export const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;
export const MAX_NAME_LENGTH = 32;

export interface CreateProfileRecordInput {
  name: string;
  tool: string;
  authType: AuthType;
  description?: string;
}

export type CreateProfileRecordResult =
  | { ok: true; name: string; wasFirstProfile: boolean }
  | { ok: false; error: string };

export interface ImportProfileRecordInput {
  name: string;
  tool: string;
  configDir: string;
  force?: boolean;
  onProgress?: (message: string) => void;
}

export type ImportProfileRecordResult =
  | { ok: true; name: string; copiedItems: string[] }
  | { ok: false; error: string };

export function validateProfileName(name: string, existingNames: string[] = []): string | null {
  if (!name) return "Profile name cannot be empty.";
  if (name.length > MAX_NAME_LENGTH) return `Profile name must be ${MAX_NAME_LENGTH} characters or less.`;
  if (!NAME_PATTERN.test(name)) {
    return "Profile name must be alphanumeric with hyphens only (no spaces or special characters). Must start with a letter or number.";
  }
  if (existingNames.includes(name)) return `Profile "${name}" already exists.`;
  return null;
}

export function createProfileRecord(input: CreateProfileRecordInput): CreateProfileRecordResult {
  try {
    const config = loadConfig();
    const validationError = validateProfileName(input.name, Object.keys(config.profiles));
    if (validationError) return { ok: false, error: validationError };

    const profileDir = getProfileDir(input.name);
    fs.mkdirSync(profileDir, { recursive: true });
    const wasFirstProfile = Object.keys(config.profiles).length === 0;
    config.profiles[input.name] = {
      authType: input.authType,
      tool: input.tool,
      configDir: profileDir,
      description: input.description,
      createdAt: new Date().toISOString(),
    };
    if (wasFirstProfile) config.activeProfile = input.name;
    saveConfig(config);
    logEvent({ level: "info", component: "profile", event: "profile.create", profile: input.name, tool: input.tool });
    return { ok: true, name: input.name, wasFirstProfile };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function importProfileRecord(input: ImportProfileRecordInput): Promise<ImportProfileRecordResult> {
  const progress = input.onProgress ?? (() => undefined);
  const sourceDir = input.configDir;
  const adapter = getAdapter(input.tool);

  try {
    const config = loadConfig();
    const validationError = validateProfileName(input.name);
    if (validationError) return { ok: false, error: validationError };
    if (!fs.existsSync(sourceDir)) return { ok: false, error: `Source directory does not exist: ${sourceDir}` };

    const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });
    const copyable = entries.filter((entry) => shouldCopyEntry(entry.name));
    if (copyable.length === 0) {
      return { ok: false, error: `Source directory does not contain any importable files: ${sourceDir}` };
    }
    if (config.profiles[input.name] && !input.force) {
      return { ok: false, error: `Profile "${input.name}" already exists. Use --force to overwrite.` };
    }

    const profileDir = getProfileDir(input.name);
    if (input.force && fs.existsSync(profileDir)) fs.rmSync(profileDir, { recursive: true, force: true });
    await fs.promises.mkdir(profileDir, { recursive: true });

    const copiedItems: string[] = [];
    for (const entry of copyable) {
      progress(adapter?.describeImportEntry?.(entry.name) ?? describeEntry(entry.name, input.tool));
      const srcPath = path.join(sourceDir, entry.name);
      const destPath = path.join(profileDir, entry.name);
      if (entry.isDirectory()) {
        await fs.promises.cp(srcPath, destPath, {
          recursive: true,
          force: true,
          dereference: true,
          filter: (candidate) => {
            const base = path.basename(candidate);
            return base !== "node_modules" && base !== ".bin";
          },
        });
        copiedItems.push(`${entry.name}/`);
      } else if (!entry.isSymbolicLink()) {
        await fs.promises.copyFile(srcPath, destPath);
        if (process.platform !== "win32" && entry.name === ".credentials.json") {
          await fs.promises.chmod(destPath, 0o600);
        }
        copiedItems.push(entry.name);
      }
    }

    if (adapter?.finalizeImport) {
      const extension = await adapter.finalizeImport({ sourceDir, profileDir, copiedItems });
      const extra = Array.isArray(extension) ? extension : extension.copiedItems;
      copiedItems.splice(0, copiedItems.length, ...extra);
    }

    const hadNoProfiles = Object.keys(config.profiles).length === 0;
    config.profiles[input.name] = {
      authType: adapter?.detectAuthType?.(sourceDir) ?? detectAuthType(sourceDir),
      tool: input.tool,
      configDir: profileDir,
      description: `Imported from ${sourceDir}`,
      createdAt: new Date().toISOString(),
    };
    if (hadNoProfiles) config.activeProfile = input.name;
    saveConfig(config);
    logEvent({ level: "info", component: "profile", event: "profile.import", profile: input.name, tool: input.tool, data: { sourceDir, copiedItems } });
    return { ok: true, name: input.name, copiedItems };
  } catch (err) {
    try {
      fs.rmSync(getProfileDir(input.name), { recursive: true, force: true });
    } catch {}
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
