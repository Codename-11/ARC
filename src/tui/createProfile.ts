import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, saveConfig } from "../config.js";
import { getProfileDir } from "../paths.js";
import type { AuthType } from "../types.js";
import { shouldCopyEntry, detectAuthType, describeEntry } from "../import-utils.js";
import { logAction } from "../log.js";

// ── Validation constants ────────────────────────────────────────────────

export const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;
export const MAX_NAME_LENGTH = 32;

// ── Render timing ───────────────────────────────────────────────────────
/** Small delay used by TUI effects so Ink can paint a spinner before sync work. */
export const RENDER_DEFER_MS = 50;

// ── Tool and auth option tables ─────────────────────────────────────────

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
  codex: [
    { value: "api-key", label: "API Key", description: "OpenAI API key" },
  ],
};

// ── Validation ──────────────────────────────────────────────────────────

export function validateName(name: string, existingNames: string[]): string | null {
  if (!name) return "Name is required.";
  if (name.length > MAX_NAME_LENGTH) return `Name must be ${MAX_NAME_LENGTH} chars or less.`;
  if (!NAME_PATTERN.test(name)) return "Must start with a letter or digit. Only letters, digits, and hyphens.";
  if (existingNames.includes(name)) return `Profile "${name}" already exists.`;
  return null;
}

// ── Creation ────────────────────────────────────────────────────────────

export interface CreateProfileInput {
  name: string;
  tool: string;
  authType: AuthType;
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
      createdAt: new Date().toISOString(),
    };

    if (wasFirst) {
      config.activeProfile = input.name;
    }

    saveConfig(config);

    logAction("profile:create", input.name);
    return { ok: true, name: input.name, wasFirstProfile: wasFirst };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// ── Import (TUI-safe) ──────────────────────────────────────────────────

export interface ImportProfileInput {
  name: string;
  tool: string;
  configDir: string;
  /** Called with a human-readable status line as each step progresses. */
  onProgress?: (message: string) => void;
}

export type ImportResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

// IMPORT_SKIP, shouldCopyEntry, detectAuthType, describeEntry are imported from ../import-utils.js

/**
 * TUI-safe profile import.  Mirrors the CLI `handleImport()` logic but
 * returns a result object instead of calling `process.exit()`.
 * Uses fs.promises so the event loop stays free (spinner can animate).
 */
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
    const copyable = entries.filter((e) => shouldCopyEntry(e.name));

    if (copyable.length === 0) {
      return { ok: false, error: `No importable files found in: ${sourceDir}` };
    }

    const config = loadConfig();

    if (config.profiles[input.name]) {
      return { ok: false, error: `Profile "${input.name}" already exists.` };
    }

    progress("Creating profile directory...");
    const profileDir = getProfileDir(input.name);
    await fsp.mkdir(profileDir, { recursive: true });

    progress("Detecting auth type...");
    const authType = detectAuthType(sourceDir);

    const copiedItems: string[] = [];
    for (const entry of copyable) {
      const srcPath = path.join(sourceDir, entry.name);
      const destPath = path.join(profileDir, entry.name);

      // Human-readable label for the progress message
      const label = describeEntry(entry.name, input.tool);
      progress(label);

      if (entry.isDirectory()) {
        try {
          await fsp.cp(srcPath, destPath, {
            recursive: true,
            force: true,
            dereference: true,
            filter: (src) => {
              const base = path.basename(src);
              if (base === "node_modules" || base === ".bin") return false;
              return true;
            },
          });
        } catch {
          copiedItems.push(entry.name + "/ (partial)");
          continue;
        }
        copiedItems.push(entry.name + "/");
      } else if (entry.isSymbolicLink()) {
        continue;
      } else {
        await fsp.copyFile(srcPath, destPath);
        if (process.platform !== "win32" && entry.name === ".credentials.json") {
          await fsp.chmod(destPath, 0o600);
        }
        copiedItems.push(entry.name);
      }
    }

    // Claude Code stores OAuth session + MCP servers in .claude.json.
    if (input.tool === "claude" && !copiedItems.includes(".claude.json")) {
      progress("Linking MCP servers & session config...");
      const claudeJsonInSource = path.join(sourceDir, ".claude.json");
      const claudeJsonInHome = path.join(os.homedir(), ".claude.json");
      let claudeJsonSrc: string | null = null;
      try {
        await fsp.access(claudeJsonInSource);
        claudeJsonSrc = claudeJsonInSource;
      } catch {
        try {
          await fsp.access(claudeJsonInHome);
          claudeJsonSrc = claudeJsonInHome;
        } catch {
          // Neither exists
        }
      }

      if (claudeJsonSrc) {
        await fsp.copyFile(claudeJsonSrc, path.join(profileDir, ".claude.json"));
      }
    }

    progress("Saving profile config...");
    const wasFirst = Object.keys(config.profiles).length === 0;

    config.profiles[input.name] = {
      authType,
      tool: input.tool,
      configDir: profileDir,
      description: `Imported from ${sourceDir}`,
      createdAt: new Date().toISOString(),
    };

    if (wasFirst) {
      config.activeProfile = input.name;
    }

    saveConfig(config);

    logAction("profile:import", `${input.name} from ${input.configDir}`);
    return { ok: true, name: input.name };
  } catch (err) {
    // Rollback: remove partially-created profile directory
    const profileDir = getProfileDir(input.name);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
