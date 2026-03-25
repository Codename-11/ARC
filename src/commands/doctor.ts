import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import { loadConfig, validateConfig } from "../config.js";
import { getConfigPath } from "../paths.js";
import { getCredentialStatus } from "../auth.js";
import { findBinary } from "./launch.js";
import { sectionHeader } from "../display.js";

// ── Output Helpers ──────────────────────────────────

function check(msg: string): void {
  console.log(`  ${pc.green("\u2714")} ${msg}`);
}

function cross(msg: string): void {
  console.log(`  ${pc.red("\u2716")} ${msg}`);
}

function warning(msg: string): void {
  console.log(`  ${pc.yellow("\u26A0")} ${msg}`);
}

// ── Diagnostic Checks ───────────────────────────────

function checkConfigFile(): boolean {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    cross(`Config file not found at ${configPath}`);
    return false;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch {
    cross(`Config file unreadable at ${configPath}`);
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    cross("Config file contains malformed JSON");
    return false;
  }

  if (!validateConfig(parsed)) {
    cross("Config file has invalid structure");
    return false;
  }

  check("Config file valid");
  return true;
}

function checkPath(): void {
  const localBin = path.join(os.homedir(), ".local", "bin");
  const envPath = process.env["PATH"] ?? "";
  const separator = process.platform === "win32" ? ";" : ":";
  const dirs = envPath.split(separator);

  if (dirs.some((d) => path.normalize(d) === path.normalize(localBin))) {
    check("PATH includes ~/.local/bin");
  } else {
    warning("~/.local/bin is not on PATH");
  }
}

type ShellType = "bash" | "zsh" | "fish" | "powershell";

function detectShell(): ShellType {
  if (process.platform === "win32") {
    return "powershell";
  }
  const shellEnv = process.env["SHELL"] ?? "";
  const base = path.basename(shellEnv);
  if (base === "zsh") return "zsh";
  if (base === "fish") return "fish";
  return "bash";
}

function getShellProfilePath(shell: ShellType): string | null {
  const home = os.homedir();
  switch (shell) {
    case "powershell":
      return path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
    case "bash":
      return path.join(home, ".bashrc");
    case "zsh":
      return path.join(home, ".zshrc");
    case "fish":
      return path.join(home, ".config", "fish", "config.fish");
  }
}

function checkShellIntegration(): void {
  const shell = detectShell();
  const profilePath = getShellProfilePath(shell);

  if (!profilePath) {
    warning(`Could not determine shell profile path for ${shell}`);
    return;
  }

  if (!fs.existsSync(profilePath)) {
    warning(`Shell profile not found: ${profilePath}`);
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(profilePath, "utf-8");
  } catch {
    warning(`Could not read shell profile: ${profilePath}`);
    return;
  }

  if (content.includes("arc shell-init")) {
    check(`Shell integration found in ${profilePath}`);
  } else {
    warning(`Shell integration not found in ${path.basename(profilePath)}`);
  }
}

function formatExpiry(expiresAt: number): string {
  const now = Date.now();
  const diff = expiresAt - now;
  const absDiff = Math.abs(diff);

  const minutes = Math.floor(absDiff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let timeStr: string;
  if (days > 0) {
    timeStr = `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    timeStr = `${hours}h ${minutes % 60}m`;
  } else {
    timeStr = `${minutes}m`;
  }

  return diff > 0 ? `expires in ${timeStr}` : `expired ${timeStr} ago`;
}

async function checkProfiles(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch {
    // Config already reported as broken above
    return;
  }

  const names = Object.keys(config.profiles);
  if (names.length === 0) {
    console.log(`  ${pc.dim("No profiles configured.")}`);
    return;
  }

  console.log();
  console.log("  " + pc.bold("Profiles:"));

  for (const name of names) {
    const profile = config.profiles[name];
    const tool = profile.tool ?? "claude";
    const isActive = name === config.activeProfile;
    const label = isActive ? pc.bold(name) + pc.dim(" *") : name;
    console.log(`    ${label} ${pc.dim(`(${tool} / ${profile.authType})`)}`);

    // Binary check
    if (findBinary(tool)) {
      console.log(`      ${pc.green("\u2714")} ${tool} binary found`);
    } else {
      console.log(`      ${pc.red("\u2716")} ${tool} binary not found`);
    }

    // Credential check
    try {
      const cred = await getCredentialStatus(profile);
      if (cred.authenticated) {
        let authMsg = "";
        switch (cred.method) {
          case "oauth":
            authMsg = "Authenticated";
            if (cred.expiresAt !== undefined) {
              authMsg += ` (${formatExpiry(cred.expiresAt)})`;
            }
            break;
          case "api-key":
            authMsg = "API key configured";
            break;
          case "env-var":
            authMsg = "API key set via env var";
            break;
          case "bedrock":
            authMsg = "Bedrock credentials configured";
            break;
          case "vertex":
            authMsg = "Vertex credentials configured";
            break;
          case "foundry":
            authMsg = "Foundry credentials configured";
            break;
        }
        console.log(`      ${pc.green("\u2714")} ${authMsg}`);
      } else {
        if (cred.expired) {
          const expiryInfo = cred.expiresAt !== undefined ? ` (${formatExpiry(cred.expiresAt)})` : "";
          console.log(`      ${pc.yellow("\u26A0")} Credentials expired${expiryInfo}`);
        } else {
          console.log(`      ${pc.red("\u2716")} Not authenticated`);
        }
      }
    } catch {
      console.log(`      ${pc.red("\u2716")} Error checking credentials`);
    }
  }
}

// ── Main Handler ────────────────────────────────────

export async function handleDoctor(): Promise<void> {
  console.log();
  sectionHeader("ARC Doctor");
  console.log();

  checkConfigFile();
  checkPath();
  checkShellIntegration();

  await checkProfiles();

  console.log();
}
