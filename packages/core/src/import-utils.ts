import fs from "node:fs";
import path from "node:path";
import type { AuthType } from "./types.js";

// ── Import skip list ────────────────────────────────────────────────────

/** Ephemeral / generated data to skip during import — everything else is copied. */
export const IMPORT_SKIP = new Set([
  // Claude Code
  "cache",
  "debug",
  "telemetry",
  "statsig",
  "usage-data",
  "shell-snapshots",
  "paste-cache",
  "file-history",
  "chrome",
  "downloads",
  "projects",
  "tasks",
  "teams",
  "todos",
  "plans",
  "history.jsonl",
  ".update.lock",
  "stats-cache.json",
  // Gemini CLI
  "extensions",       // Contains node_modules with symlinks — large and tool-managed
  "history",
  "tmp",
  "antigravity",
  // Codex CLI
  "sessions",
  "cache",
  "log",
  "logs_1.sqlite",
  "state_5.sqlite",
  "session_index.jsonl",
  "sandbox.log",
  "vendor_imports",
  "sqlite",
  "models_cache.json",
  // Common
  "node_modules",
]);

// ── Entry filter ────────────────────────────────────────────────────────

export function shouldCopyEntry(name: string): boolean {
  if (IMPORT_SKIP.has(name)) return false;
  if (name.includes(".backup.")) return false;
  if (name.endsWith(".sqlite")) return false;
  return true;
}

// ── Auth detection ──────────────────────────────────────────────────────

/**
 * Detect the auth type from a source config directory by inspecting
 * which credential files / env markers are present.
 */
export function detectAuthType(sourceDir: string): AuthType {
  // Check for environment-based auth types first (most specific)
  if (
    process.env["AWS_PROFILE"] ||
    process.env["AWS_ACCESS_KEY_ID"] ||
    process.env["CLAUDE_CODE_USE_BEDROCK"] === "1"
  ) {
    return "bedrock";
  }
  if (
    process.env["GOOGLE_APPLICATION_CREDENTIALS"] ||
    process.env["CLAUDE_CODE_USE_VERTEX"] === "1"
  ) {
    return "vertex";
  }
  if (process.env["FOUNDRY_API_KEY"]) {
    return "foundry";
  }

  // Check for file-based auth indicators
  if (fs.existsSync(path.join(sourceDir, ".api-key"))) {
    return "api-key";
  }

  // Claude Code: .credentials.json with claudeAiOauth/oauthAccount wrapper
  if (fs.existsSync(path.join(sourceDir, ".credentials.json"))) {
    try {
      const raw = fs.readFileSync(
        path.join(sourceDir, ".credentials.json"),
        "utf-8"
      );
      const creds = JSON.parse(raw) as Record<string, unknown>;
      if (creds["accessToken"] || creds["refreshToken"] || creds["claudeAiOauth"] || creds["oauthAccount"]) {
        return "oauth";
      }
    } catch {
      // Malformed JSON — fall through
    }
  }

  // Gemini CLI: oauth_creds.json with access_token/refresh_token
  if (fs.existsSync(path.join(sourceDir, "oauth_creds.json"))) {
    try {
      const raw = fs.readFileSync(
        path.join(sourceDir, "oauth_creds.json"),
        "utf-8"
      );
      const creds = JSON.parse(raw) as Record<string, unknown>;
      if (creds["access_token"] || creds["refresh_token"]) {
        return "oauth";
      }
    } catch {
      // Malformed JSON — fall through
    }
  }

  // Codex CLI: auth.json with tokens.access_token
  if (fs.existsSync(path.join(sourceDir, "auth.json"))) {
    try {
      const raw = fs.readFileSync(
        path.join(sourceDir, "auth.json"),
        "utf-8"
      );
      const creds = JSON.parse(raw) as Record<string, unknown>;
      if (typeof creds["tokens"] === "object" && creds["tokens"] !== null) {
        const tokens = creds["tokens"] as Record<string, unknown>;
        if (tokens["access_token"] || tokens["refresh_token"]) {
          return "oauth";
        }
      }
      // Codex also supports API key mode
      if (creds["OPENAI_API_KEY"] && typeof creds["OPENAI_API_KEY"] === "string") {
        return "api-key";
      }
    } catch {
      // Malformed JSON — fall through
    }
  }

  return "oauth";
}

// ── Entry description ───────────────────────────────────────────────────

/** Map file/dir names to human-readable progress labels. */
export function describeEntry(name: string, tool: string): string {
  // Credentials
  if (name === ".credentials.json") return "Copying OAuth credentials...";
  if (name === "oauth_creds.json") return "Copying OAuth credentials...";
  if (name === "auth.json") return "Copying auth config...";
  if (name === "google_accounts.json") return "Copying account info...";
  if (name === ".api-key") return "Copying API key...";

  // Settings & config
  if (name === "settings.json") return "Copying settings...";
  if (name === "config.json" || name === "config.toml") return "Copying config...";
  if (name === ".claude.json") return "Copying MCP servers & session config...";
  if (name === "GEMINI.md" || name === "AGENTS.md") return "Copying agent instructions...";

  // Data directories
  if (name === "plugins") return `Copying ${tool} plugins...`;
  if (name === "skills") return `Copying ${tool} skills...`;
  if (name === "memories") return "Copying memories...";
  if (name === "commands") return "Copying custom commands...";

  // State files
  if (name === "state.json" || name === "projects.json") return "Copying state...";
  if (name === "trustedFolders.json") return "Copying trusted folders...";
  if (name === "installation_id") return "Copying installation ID...";
  if (name === "version.json") return "Copying version info...";

  // Generic
  if (name.endsWith("/")) return `Copying ${name}...`;
  return `Copying ${name}...`;
}
