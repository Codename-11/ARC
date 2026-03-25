import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AuthType } from "../types.js";
import { loadConfig, saveConfig, resolveProfileName } from "../config.js";
import { getProfileDir, getClaudeDefaultDir } from "../paths.js";
import { success, error, info, detail, profileTable } from "../display.js";

const VALID_AUTH_TYPES = new Set<string>([
  "oauth",
  "api-key",
  "bedrock",
  "vertex",
  "foundry",
]);

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;
const MAX_NAME_LENGTH = 32;

function validateProfileName(name: string): string | null {
  if (name.length === 0) {
    return "Profile name cannot be empty.";
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `Profile name must be ${MAX_NAME_LENGTH} characters or less.`;
  }
  if (!NAME_PATTERN.test(name)) {
    return "Profile name must be alphanumeric with hyphens only (no spaces or special characters). Must start with a letter or number.";
  }
  return null;
}

function isValidAuthType(value: string): value is AuthType {
  return VALID_AUTH_TYPES.has(value);
}

async function promptAuthType(): Promise<AuthType> {
  try {
    const { select } = await import("@inquirer/prompts");
    const authType = await select<AuthType>({
      message: "Select authentication type:",
      choices: [
        { value: "oauth" as const, name: "OAuth (claude.ai account)" },
        { value: "api-key" as const, name: "API Key (Anthropic / provider API)" },
        { value: "bedrock" as const, name: "AWS Bedrock" },
        { value: "vertex" as const, name: "Google Vertex AI" },
        { value: "foundry" as const, name: "Foundry" },
      ],
    });
    return authType;
  } catch {
    return "oauth";
  }
}

async function promptDescription(): Promise<string | undefined> {
  try {
    const { input } = await import("@inquirer/prompts");
    const desc = await input({
      message: "Profile description (optional):",
    });
    return desc || undefined;
  } catch {
    return undefined;
  }
}

export async function handleCreate(
  name: string,
  opts: { authType?: string; tool?: string; description?: string }
): Promise<void> {
  const nameError = validateProfileName(name);
  if (nameError) {
    error(nameError);
    process.exit(1);
  }

  const config = loadConfig();

  if (config.profiles[name]) {
    error(`Profile "${name}" already exists.`);
    process.exit(1);
  }

  let authType: AuthType;
  if (opts.authType) {
    if (!isValidAuthType(opts.authType)) {
      error(
        `Invalid auth type "${opts.authType}". Must be one of: oauth, api-key, bedrock, vertex, foundry.`
      );
      process.exit(1);
    }
    authType = opts.authType;
  } else {
    authType = await promptAuthType();
  }

  const description = opts.description ?? (await promptDescription());
  const tool = opts.tool ?? "claude";

  const profileDir = getProfileDir(name);
  fs.mkdirSync(profileDir, { recursive: true });

  config.profiles[name] = {
    authType,
    tool,
    configDir: profileDir,
    description,
    createdAt: new Date().toISOString(),
  };

  const isFirstProfile = Object.keys(config.profiles).length === 1;
  if (isFirstProfile) {
    config.activeProfile = name;
  }

  saveConfig(config);

  success(`Profile "${name}" created.`);
  info(`Tool:          ${tool}`);
  info(`Config directory: ${profileDir}`);

  if (isFirstProfile) {
    info(`Set as active profile.`);
  }

  if (authType === "oauth") {
    info(`Run "arc launch ${name}" to start ${tool} and sign in.`);
  } else if (authType === "api-key") {
    info(`Run "arc set-key ${name}" to store your API key.`);
  }
}

export async function handleList(): Promise<void> {
  const config = loadConfig();
  const names = Object.keys(config.profiles);

  if (names.length === 0) {
    info(
      'No profiles configured. Run "arc profile create <name>" to get started.'
    );
    return;
  }

  const rows = names.map((name) => {
    const profile = config.profiles[name];
    return {
      name,
      active: name === config.activeProfile,
      authType: profile.authType,
      description: profile.description,
    };
  });

  const table = profileTable(rows);
  process.stdout.write(table + "\n");
}

export async function handleShow(name?: string): Promise<void> {
  const config = loadConfig();
  const resolved = resolveProfileName(config, name);
  const profile = config.profiles[resolved];

  if (!profile) {
    error(`Profile "${resolved}" not found.`);
    process.exit(1);
  }

  const isActive = resolved === config.activeProfile;

  process.stdout.write(`Name:        ${resolved}${isActive ? " (active)" : ""}\n`);
  process.stdout.write(`Tool:        ${profile.tool ?? "claude"}\n`);
  process.stdout.write(`Auth Type:   ${profile.authType}\n`);
  process.stdout.write(`Config Dir:  ${profile.configDir}\n`);
  if (profile.description) {
    process.stdout.write(`Description: ${profile.description}\n`);
  }
  process.stdout.write(`Created:     ${profile.createdAt}\n`);
  if (profile.envOverrides && Object.keys(profile.envOverrides).length > 0) {
    process.stdout.write(`Env Overrides:\n`);
    for (const [key, value] of Object.entries(profile.envOverrides)) {
      process.stdout.write(`  ${key}=${value}\n`);
    }
  }
}

export async function handleSwitch(name: string): Promise<void> {
  const config = loadConfig();

  if (!config.profiles[name]) {
    error(`Profile "${name}" not found.`);
    process.exit(1);
  }

  config.activeProfile = name;
  saveConfig(config);
  success(`Switched to profile "${name}".`);
}

export async function handleDelete(name: string): Promise<void> {
  const config = loadConfig();

  if (!config.profiles[name]) {
    error(`Profile "${name}" not found.`);
    process.exit(1);
  }

  const profileCount = Object.keys(config.profiles).length;
  if (profileCount <= 1) {
    error("Cannot delete the only remaining profile.");
    process.exit(1);
  }

  const profileDir = config.profiles[name].configDir;

  delete config.profiles[name];

  if (config.activeProfile === name) {
    const remaining = Object.keys(config.profiles);
    config.activeProfile = remaining[0];
    info(`Active profile switched to "${remaining[0]}".`);
  }

  saveConfig(config);

  try {
    fs.rmSync(profileDir, { recursive: true, force: true });
  } catch {
    // Directory may not exist or be inaccessible -- config is already updated
  }

  success(`Profile "${name}" deleted.`);
}

// Ephemeral / generated data to skip during import — everything else is copied.
const IMPORT_SKIP = new Set([
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
]);

function shouldCopyEntry(name: string): boolean {
  if (IMPORT_SKIP.has(name)) return false;
  if (name.includes(".backup.")) return false;
  return true;
}

/**
 * Detect the auth type from a source config directory by inspecting
 * which credential files / env markers are present.
 */
function detectAuthType(sourceDir: string): AuthType {
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

  if (fs.existsSync(path.join(sourceDir, ".credentials.json"))) {
    try {
      const raw = fs.readFileSync(
        path.join(sourceDir, ".credentials.json"),
        "utf-8"
      );
      const creds = JSON.parse(raw) as Record<string, unknown>;
      if (creds["accessToken"] || creds["refreshToken"]) {
        return "oauth";
      }
    } catch {
      // Malformed JSON — fall through to default
    }
  }

  return "oauth";
}

export async function handleImport(
  opts: { name: string; from?: string; tool?: string; force?: boolean }
): Promise<void> {
  const tool = opts.tool ?? "claude";
  const sourceDir = opts.from ?? getClaudeDefaultDir();
  const profileName = opts.name;

  const nameError = validateProfileName(profileName);
  if (nameError) {
    error(nameError);
    process.exit(1);
  }

  if (!fs.existsSync(sourceDir)) {
    error(`Source directory does not exist: ${sourceDir}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  const copyable = entries.filter((e) => shouldCopyEntry(e.name));

  if (copyable.length === 0) {
    error(`Source directory does not contain any importable files: ${sourceDir}`);
    process.exit(1);
  }

  const config = loadConfig();

  if (config.profiles[profileName] && !opts.force) {
    error(
      `Profile "${profileName}" already exists. Use --force to overwrite.`
    );
    process.exit(1);
  }

  const profileDir = getProfileDir(profileName);
  if (opts.force && fs.existsSync(profileDir)) {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
  fs.mkdirSync(profileDir, { recursive: true });

  const authType = detectAuthType(sourceDir);

  // Copy all config files and directories from source
  const copiedItems: string[] = [];
  for (const entry of copyable) {
    const srcPath = path.join(sourceDir, entry.name);
    const destPath = path.join(profileDir, entry.name);

    if (entry.isDirectory()) {
      fs.cpSync(srcPath, destPath, { recursive: true, force: true });
      copiedItems.push(entry.name + "/");
    } else {
      fs.copyFileSync(srcPath, destPath);
      if (process.platform !== "win32" && entry.name === ".credentials.json") {
        fs.chmodSync(destPath, 0o600);
      }
      copiedItems.push(entry.name);
    }
  }

  // Claude Code stores OAuth session + MCP servers + per-project settings
  // in .claude.json. When CLAUDE_CONFIG_DIR is set it reads from
  // $CLAUDE_CONFIG_DIR/.claude.json. The default location is ~/.claude.json
  // (home root, NOT inside ~/.claude/). Custom CLAUDE_CONFIG_DIR installs
  // store it inside the config dir itself.
  if (tool === "claude" && !copiedItems.includes(".claude.json")) {
    const claudeJsonInSource = path.join(sourceDir, ".claude.json");
    const claudeJsonInHome = path.join(os.homedir(), ".claude.json");
    const claudeJsonSrc = fs.existsSync(claudeJsonInSource)
      ? claudeJsonInSource
      : fs.existsSync(claudeJsonInHome)
        ? claudeJsonInHome
        : null;

    if (claudeJsonSrc) {
      fs.copyFileSync(claudeJsonSrc, path.join(profileDir, ".claude.json"));
      copiedItems.push(".claude.json");
    }
  }

  const hadNoProfiles = Object.keys(config.profiles).length === 0;

  config.profiles[profileName] = {
    authType,
    tool,
    configDir: profileDir,
    description: `Imported from ${sourceDir}`,
    createdAt: new Date().toISOString(),
  };

  if (hadNoProfiles) {
    config.activeProfile = profileName;
  }

  saveConfig(config);

  success(`Profile "${profileName}" imported from ${sourceDir}`);
  detail(`Tool:   ${tool}`);
  detail(`Copied: ${copiedItems.join(", ")}`);
  detail(`Config: ${profileDir}`);
}
