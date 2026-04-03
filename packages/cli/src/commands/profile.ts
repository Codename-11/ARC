import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import type { AuthType } from "../types.js";
import { loadConfig, saveConfig, resolveProfileName } from "../config.js";
import { success, error, info, detail, profileTable } from "../display.js";
import { createProfile, importProfile, validateName } from "../tui/createProfile.js";

const VALID_AUTH_TYPES = new Set<string>(["oauth", "api-key", "bedrock", "vertex", "foundry"]);

function isValidAuthType(value: string): value is AuthType {
  return VALID_AUTH_TYPES.has(value);
}

async function promptAuthType(): Promise<AuthType> {
  try {
    const { select } = await import("@inquirer/prompts");
    return await select<AuthType>({
      message: "Select authentication type:",
      choices: [
        { value: "oauth" as const, name: "OAuth (claude.ai account)" },
        { value: "api-key" as const, name: "API Key (Anthropic / provider API)" },
        { value: "bedrock" as const, name: "AWS Bedrock" },
        { value: "vertex" as const, name: "Google Vertex AI" },
        { value: "foundry" as const, name: "Foundry" },
      ],
    });
  } catch {
    return "oauth";
  }
}

async function promptDescription(): Promise<string | undefined> {
  if (!process.stdin.isTTY) {
    return undefined;
  }
  try {
    const { input } = await import("@inquirer/prompts");
    const desc = await input({ message: "Profile description (optional):" });
    return desc || undefined;
  } catch {
    return undefined;
  }
}

export async function handleCreate(
  name: string,
  opts: { authType?: string; tool?: string; description?: string }
): Promise<void> {
  const config = loadConfig();
  const nameError = validateName(name, Object.keys(config.profiles));
  if (nameError) {
    error(nameError);
    process.exit(1);
  }

  let authType: AuthType;
  if (opts.authType) {
    if (!isValidAuthType(opts.authType)) {
      error(`Invalid auth type "${opts.authType}". Must be one of: oauth, api-key, bedrock, vertex, foundry.`);
      process.exit(1);
    }
    authType = opts.authType;
  } else {
    authType = await promptAuthType();
  }

  const description = opts.description ?? (await promptDescription());
  const tool = opts.tool ?? "claude";
  const result = createProfile({ name, authType, tool, description });
  if (!result.ok) {
    error(result.error);
    process.exit(1);
  }

  const profileDir = loadConfig().profiles[name]?.configDir ?? "(unknown)";
  success(`Profile "${name}" created.`);
  info(`Tool:          ${tool}`);
  info(`Config directory: ${profileDir}`);
  if (result.wasFirstProfile) info("Set as active profile.");
  if (authType === "oauth") info(`Run "arc launch ${name}" to start ${tool} and sign in.`);
  else if (authType === "api-key") info(`Run "arc set-key ${name}" to store your API key.`);
}

export async function handleList(): Promise<void> {
  const config = loadConfig();
  const names = Object.keys(config.profiles);
  if (names.length === 0) {
    info('No profiles configured. Run "arc profile create <name>" to get started.');
    return;
  }

  const rows = names.map((name) => ({
    name,
    active: name === config.activeProfile,
    authType: config.profiles[name].authType,
    description: config.profiles[name].description,
  }));
  process.stdout.write(profileTable(rows) + "\n");
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
  if (profile.description) process.stdout.write(`Description: ${profile.description}\n`);
  process.stdout.write(`Created:     ${profile.createdAt}\n`);
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

export async function handleDelete(name: string, opts?: { force?: boolean }): Promise<void> {
  const config = loadConfig();
  if (!config.profiles[name]) {
    error(`Profile "${name}" not found.`);
    process.exit(1);
  }
  if (Object.keys(config.profiles).length <= 1) {
    error("Cannot delete the only remaining profile.");
    process.exit(1);
  }

  if (!opts?.force) {
    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(`  Delete profile "${name}" and all its config data? This cannot be undone. [y/N] `, resolve);
    });
    rl.close();
    if (answer.toLowerCase() !== "y") {
      info("Cancelled.");
      return;
    }
  }

  try {
    fs.rmSync(config.profiles[name].configDir, { recursive: true, force: true });
  } catch {
    // continue with config cleanup
  }
  delete config.profiles[name];
  if (config.activeProfile === name) {
    const remaining = Object.keys(config.profiles);
    config.activeProfile = remaining[0]!;
    info(`Active profile switched to "${remaining[0]}".`);
  }
  saveConfig(config);
  success(`Profile "${name}" deleted.`);
}

export async function handleImport(
  opts: { name: string; from?: string; tool?: string; force?: boolean }
): Promise<void> {
  const tool = opts.tool ?? "claude";
  const sourceDir =
    opts.from ?? (tool === "claude" ? path.join(os.homedir(), ".claude") : path.join(os.homedir(), `.${tool}`));
  const config = loadConfig();
  const nameError = validateName(
    opts.name,
    opts.force ? Object.keys(config.profiles).filter((name) => name !== opts.name) : Object.keys(config.profiles)
  );
  if (nameError) {
    error(nameError);
    process.exit(1);
  }
  const result = await importProfile({ name: opts.name, tool, configDir: sourceDir, force: opts.force });
  if (!result.ok) {
    error(result.error);
    process.exit(1);
  }
  success(`Profile "${opts.name}" imported from ${sourceDir}`);
  detail(`Tool:   ${tool}`);
  detail(`Config: ${loadConfig().profiles[opts.name]?.configDir ?? "(unknown)"}`);
}


