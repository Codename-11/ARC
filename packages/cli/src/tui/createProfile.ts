import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig } from "../config.js";
import { getProfileDir } from "../paths.js";
import type { AuthType } from "../types.js";
import { shouldCopyEntry, detectAuthType, describeEntry } from "../import-utils.js";
import { logAction } from "../log.js";
import { getAdapter } from "../adapters/index.js";

export const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;
export const MAX_NAME_LENGTH = 32;
export const RENDER_DEFER_MS = 50;

export interface OptionItem {
  value: string;
  label: string;
  description: string;
}

export interface AuthOptionItem {
  value: AuthType;
  label: string;
  description: string;
}

export const TOOL_OPTIONS: OptionItem[] = [
  { value: "claude", label: "Claude Code", description: "Anthropic CLI agent" },
  { value: "gemini", label: "Gemini CLI", description: "Google AI CLI agent" },
  { value: "codex", label: "Codex CLI", description: "OpenAI CLI agent" },
  { value: "openclaw", label: "OpenClaw", description: "OpenClaw Gateway (plugin)" },
  { value: "hermes", label: "Hermes Agent", description: "Nous Research agent" },
];

export const AUTH_OPTIONS: Record<string, AuthOptionItem[]> = {
  claude: [
    { value: "oauth", label: "OAuth", description: "Browser-based login" },
    { value: "api-key", label: "API Key", description: "Anthropic API key" },
    { value: "bedrock", label: "AWS Bedrock", description: "AWS credentials" },
    { value: "vertex", label: "Google Vertex", description: "GCP credentials" },
    { value: "foundry", label: "Foundry", description: "Foundry API key" },
  ],
  gemini: [
    { value: "api-key", label: "API Key", description: "Google AI API key" },
    { value: "vertex", label: "Google Vertex", description: "GCP credentials" },
  ],
  codex: [{ value: "api-key", label: "API Key", description: "OpenAI API key" }],
  openclaw: [{ value: "api-key", label: "API Key", description: "Provider API key (Anthropic, OpenAI, etc.)" }],
  hermes: [{ value: "api-key", label: "API Key", description: "Provider API key (OpenRouter, Anthropic, etc.)" }],
};

export function validateName(name: string, existingNames: string[]): string | null {
  if (!name) return "Name is required.";
  if (name.length > MAX_NAME_LENGTH) return `Name must be ${MAX_NAME_LENGTH} chars or less.`;
  if (!NAME_PATTERN.test(name)) return "Must start with a letter or digit. Only letters, digits, and hyphens.";
  if (existingNames.includes(name)) return `Profile "${name}" already exists.`;
  return null;
}

export interface CreateProfileInput {
  name: string;
  tool: string;
  authType: AuthType;
  description?: string;
}

export type CreateResult =
  | { ok: true; name: string; wasFirstProfile: boolean }
  | { ok: false; error: string };

export function createProfile(input: CreateProfileInput): CreateResult {
  try {
    const config = loadConfig();
    if (config.profiles[input.name]) {
      return { ok: false, error: `Profile "${input.name}" already exists.` };
    }

    const profileDir = getProfileDir(input.name);
    fs.mkdirSync(profileDir, { recursive: true });
    const wasFirst = Object.keys(config.profiles).length === 0;
    config.profiles[input.name] = {
      authType: input.authType,
      tool: input.tool,
      configDir: profileDir,
      description: input.description,
      createdAt: new Date().toISOString(),
    };
    if (wasFirst) {
      config.activeProfile = input.name;
    }
    saveConfig(config);
    logAction("profile.create", input.name, { component: "profile", profile: input.name, tool: input.tool });
    return { ok: true, name: input.name, wasFirstProfile: wasFirst };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ImportProfileInput {
  name: string;
  tool: string;
  configDir: string;
  force?: boolean;
  onProgress?: (message: string) => void;
}

export type ImportResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

export async function importProfile(input: ImportProfileInput): Promise<ImportResult> {
  const progress = input.onProgress ?? (() => {});
  try {
    const fsp = fs.promises;
    const sourceDir = input.configDir;
    progress("Scanning source directory...");
    try {
      await fsp.access(sourceDir);
    } catch {
      return { ok: false, error: `Source directory does not exist: ${sourceDir}` };
    }

    const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
    const copyable = entries.filter((entry) => shouldCopyEntry(entry.name));
    if (copyable.length === 0) {
      return { ok: false, error: `No importable files found in: ${sourceDir}` };
    }

    const config = loadConfig();
    if (config.profiles[input.name] && !input.force) {
      return { ok: false, error: `Profile "${input.name}" already exists.` };
    }

    progress("Creating profile directory...");
    const profileDir = getProfileDir(input.name);
    if (input.force) {
      await fsp.rm(profileDir, { recursive: true, force: true });
    }
    await fsp.mkdir(profileDir, { recursive: true });

    progress("Detecting auth type...");
    const adapter = getAdapter(input.tool);
    const authType = adapter.detectAuthType?.(sourceDir) ?? detectAuthType(sourceDir);

    for (const entry of copyable) {
      const srcPath = path.join(sourceDir, entry.name);
      const destPath = path.join(profileDir, entry.name);
      progress(adapter.describeImportEntry?.(entry.name) ?? describeEntry(entry.name, input.tool));

      if (entry.isDirectory()) {
        await fsp.cp(srcPath, destPath, {
          recursive: true,
          force: true,
          dereference: true,
          filter: (src) => {
            const base = path.basename(src);
            return base !== "node_modules" && base !== ".bin";
          },
        });
      } else if (!entry.isSymbolicLink()) {
        await fsp.copyFile(srcPath, destPath);
        if (process.platform !== "win32" && entry.name === ".credentials.json") {
          await fsp.chmod(destPath, 0o600);
        }
      }
    }

    const copiedItems = copyable.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
    const finalized = adapter.finalizeImport ? await adapter.finalizeImport({ sourceDir, profileDir, copiedItems }) : null;
    const finalItems = Array.isArray(finalized)
      ? finalized
      : finalized?.copiedItems ?? copiedItems;

    config.profiles[input.name] = {
      authType,
      tool: input.tool,
      configDir: profileDir,
      description: `Imported from ${sourceDir}`,
      createdAt: new Date().toISOString(),
    };
    if (Object.keys(config.profiles).length === 1) {
      config.activeProfile = input.name;
    }
    saveConfig(config);
    logAction("profile.import", `${input.name} from ${input.configDir}`, { component: "profile", profile: input.name, tool: input.tool, data: { copiedItems: finalItems } });
    return { ok: true, name: input.name };
  } catch (err) {
    try {
      fs.rmSync(getProfileDir(input.name), { recursive: true, force: true });
    } catch {}
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

