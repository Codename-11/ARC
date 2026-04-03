import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { HealthCheck, HealthReport } from "../../../core/src/health.js";
import { buildHealthReport } from "../../../core/src/health.js";
import { loadConfig, validateConfig } from "../config.js";
import { getConfigPath } from "../paths.js";
import { getLogsDir } from "../log.js";
import { getCredentialStatus } from "../auth.js";
import { getAdapter } from "../adapters/index.js";
import type { Profile } from "../types.js";

export interface DoctorSystemStatus {
  nodeVersionOk: boolean;
  nodeVersionMessage: string;
  pathOk: boolean;
  shellIntegrationOk: boolean;
  shellProfile: string | null;
}

export function checkBinaryAvailable(name: string): boolean {
  const result = process.platform === "win32"
    ? spawnSync("cmd", ["/c", "where", name], { stdio: "ignore" })
    : spawnSync("which", [name], { stdio: "ignore" });
  return result.status === 0;
}

function detectShell(): "bash" | "zsh" | "fish" | "powershell" {
  if (process.platform === "win32") return "powershell";
  const shellEnv = process.env["SHELL"] ?? "";
  const base = path.basename(shellEnv);
  if (base === "zsh") return "zsh";
  if (base === "fish") return "fish";
  return "bash";
}

function getShellProfilePath(shell: "bash" | "zsh" | "fish" | "powershell"): string | null {
  const home = os.homedir();
  switch (shell) {
    case "powershell": return path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
    case "bash": return path.join(home, ".bashrc");
    case "zsh": return path.join(home, ".zshrc");
    case "fish": return path.join(home, ".config", "fish", "config.fish");
  }
}

function getNodeVersionStatus(): { ok: boolean; message: string } {
  const version = process.version.replace(/^v/, "");
  const major = parseInt(version.split(".")[0] ?? "0", 10);
  if (major >= 24) return { ok: true, message: `Node.js ${process.version} — some third-party tools may show DEP0190 warnings` };
  if (major >= 20) return { ok: true, message: `Node.js ${process.version}` };
  return { ok: false, message: `Node.js ${process.version} — ARC requires Node.js >= 20` };
}

export function getDoctorSystemStatus(): DoctorSystemStatus {
  const localBin = process.env["ARC_LOCAL_BIN_DIR"] || path.join(os.homedir(), ".local", "bin");
  const envPath = process.env["PATH"] ?? "";
  const separator = process.platform === "win32" ? ";" : ":";
  const dirs = envPath.split(separator);
  const pathOk = dirs.some((dir) => path.normalize(dir) === path.normalize(localBin));
  const shellProfile = getShellProfilePath(detectShell());
  let shellIntegrationOk = false;
  if (shellProfile && fs.existsSync(shellProfile)) {
    try { shellIntegrationOk = fs.readFileSync(shellProfile, "utf-8").includes("arc shell-init"); } catch {}
  }
  const node = getNodeVersionStatus();
  return { nodeVersionOk: node.ok, nodeVersionMessage: node.message, pathOk, shellIntegrationOk, shellProfile };
}

function canWriteLogDir(): boolean {
  try {
    fs.mkdirSync(getLogsDir(), { recursive: true });
    const probe = path.join(getLogsDir(), `.write-test-${process.pid}`);
    fs.writeFileSync(probe, "ok", "utf-8");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function buildConfigChecks(): HealthCheck[] {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return [{ id: "config-file", label: "ARC config file", status: "fail", summary: `Config file not found at ${configPath}` }];
  }
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return [{ id: "config-file", label: "ARC config file", status: validateConfig(parsed) ? "pass" : "fail", summary: validateConfig(parsed) ? "Config file valid" : "Config file has invalid structure" }];
  } catch {
    return [{ id: "config-file", label: "ARC config file", status: "fail", summary: `Config file unreadable or malformed at ${configPath}` }];
  }
}

async function buildProfileChecks(profileName: string, profile: Profile): Promise<HealthCheck[]> {
  const tool = profile.tool ?? "claude";
  const adapter = getAdapter(tool);
  const credential = await getCredentialStatus(profile, tool);
  const binaryAvailable = checkBinaryAvailable(tool);
  return [
    { id: `profile-${profileName}-binary`, label: `${profileName} binary`, status: binaryAvailable ? "pass" : "fail", summary: binaryAvailable ? `${tool} binary found` : `${tool} binary not found`, profile: profileName, tool },
    { id: `profile-${profileName}-auth`, label: `${profileName} authentication`, status: credential.authenticated ? "pass" : credential.expired ? "warn" : "fail", summary: credential.authenticated ? `Authenticated via ${credential.method}` : credential.expired ? "Credentials expired" : "Not authenticated", profile: profileName, tool },
    ...((await adapter.getHealthChecks?.(profile, profileName)) ?? []).map((check) => ({ id: `${profileName}-${check.key}`, label: check.label, status: check.status === "ok" ? "pass" : check.status, summary: check.summary, detail: check.detail, profile: profileName, tool })),
  ];
}

export async function getRuntimeHealthReport(): Promise<HealthReport> {
  const checks: HealthCheck[] = [];
  checks.push(...buildConfigChecks());

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ id: "config-load", label: "Config loading", status: "fail", summary: message });
    return buildHealthReport(checks);
  }

  checks.push({ id: "profiles-present", label: "Profiles configured", status: Object.keys(config.profiles).length > 0 ? "pass" : "fail", summary: Object.keys(config.profiles).length > 0 ? `${Object.keys(config.profiles).length} profiles configured` : "No profiles configured" });
  checks.push({ id: "active-profile", label: "Active profile", status: config.profiles[config.activeProfile] ? "pass" : "fail", summary: config.profiles[config.activeProfile] ? `Active profile is ${config.activeProfile}` : `Active profile ${config.activeProfile} is missing`, profile: config.activeProfile });
  const logDirWritable = canWriteLogDir();
  checks.push({ id: "log-dir", label: "Log directory", status: logDirWritable ? "pass" : "fail", summary: logDirWritable ? `Log directory writable at ${getLogsDir()}` : `Log directory not writable at ${getLogsDir()}` });
  for (const [name, profile] of Object.entries(config.profiles)) {
    checks.push(...(await buildProfileChecks(name, profile)));
  }
  return buildHealthReport(checks, config.activeProfile);
}
