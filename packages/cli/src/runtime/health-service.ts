import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type CredentialStatus,
  type HealthCheck,
  summarizeHealthChecks,
  getArcDir,
  getConfigPath,
  getLogsDir,
  loadConfig,
  validateConfig,
} from "@axiom-labs/arc-core";
import type { AuthType, Profile } from "../types.js";
import { getCredentialStatus } from "../auth.js";
import { findBinary, getInstallHint } from "./tooling.js";
import { getAdapter } from "../adapters/index.js";

type ShellType = "bash" | "zsh" | "fish" | "powershell";

export interface ProfileHealthReport {
  name: string;
  tool: string;
  authType: AuthType;
  credential: CredentialStatus | null;
  credentialError?: string;
  checks: HealthCheck[];
}

export interface HealthReport {
  configPath: string;
  systemChecks: HealthCheck[];
  profileReports: ProfileHealthReport[];
  summary: ReturnType<typeof summarizeHealthChecks>;
  shellProfile: string | null;
}

function detectShell(): ShellType {
  if (process.platform === "win32") return "powershell";
  const shellEnv = process.env["SHELL"] ?? "";
  const base = path.basename(shellEnv);
  if (base === "zsh") return "zsh";
  if (base === "fish") return "fish";
  return "bash";
}

function getShellProfilePath(shell: ShellType): string | null {
  const home = os.homedir();
  switch (shell) {
    case "powershell": return path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
    case "bash": return path.join(home, ".bashrc");
    case "zsh": return path.join(home, ".zshrc");
    case "fish": return path.join(home, ".config", "fish", "config.fish");
  }
}

function getPathCheck(): HealthCheck {
  const localBin = process.env["ARC_LOCAL_BIN_DIR"] ?? path.join(os.homedir(), ".local", "bin");
  const separator = process.platform === "win32" ? ";" : ":";
  const ok = (process.env["PATH"] ?? "").split(separator).some((dir) => path.normalize(dir) === path.normalize(localBin));
  return { id: "system:path", label: ok ? "PATH includes ARC shim directory" : "ARC shim directory is not on PATH", status: ok ? "pass" : "warn", component: "system", hint: "Run `arc setup` to fix PATH integration." };
}

function getShellIntegrationCheck(shellProfile: string | null): HealthCheck {
  if (!shellProfile || !fs.existsSync(shellProfile)) {
    return { id: "system:shell-profile", label: "Shell profile not found", status: "warn", component: "system", hint: "Run `arc setup` to add shell integration." };
  }
  try {
    const ok = fs.readFileSync(shellProfile, "utf-8").includes("arc shell-init");
    return { id: "system:shell-integration", label: ok ? `Shell integration found in ${path.basename(shellProfile)}` : `Shell integration missing in ${path.basename(shellProfile)}`, status: ok ? "pass" : "warn", component: "system", hint: "Run `arc setup` to add shell integration." };
  } catch {
    return { id: "system:shell-integration", label: `Shell profile unreadable: ${path.basename(shellProfile)}`, status: "warn", component: "system", hint: "Ensure the shell profile is readable or rerun `arc setup`." };
  }
}

function getConfigChecks(): HealthCheck[] {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return [{ id: "runtime:config", label: "ARC config file not found", status: "fail", component: "runtime", hint: "Create or import a profile to initialize ARC config." }];
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (!validateConfig(parsed)) {
      return [{ id: "runtime:config", label: "ARC config file has an invalid structure", status: "fail", component: "runtime", hint: "Repair or delete the config file and rerun ARC." }];
    }
  } catch {
    return [{ id: "runtime:config", label: "ARC config file is unreadable or malformed", status: "fail", component: "runtime", hint: "Repair or delete the config file and rerun ARC." }];
  }
  return [{ id: "runtime:config", label: "ARC config file is readable", status: "pass", component: "runtime" }];
}

function getWritableDirectoryCheck(dirPath: string, id: string, label: string): HealthCheck {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    return { id, label, status: "pass", component: "runtime" };
  } catch {
    return { id, label: `${label} (not writable)`, status: "fail", component: "runtime", hint: "Ensure ARC can create and write to its runtime directories." };
  }
}

async function buildProfileReport(name: string, profile: Profile): Promise<ProfileHealthReport> {
  const tool = profile.tool ?? "claude";
  const binaryFound = findBinary(tool);
  const checks: HealthCheck[] = [{ id: `${name}:binary`, label: binaryFound ? `${tool} binary found` : `${tool} binary not found`, status: binaryFound ? "pass" : "fail", component: "runtime", profile: name, hint: getInstallHint(tool) }];
  let credential: CredentialStatus | null = null;
  let credentialError: string | undefined;
  try {
    credential = await getCredentialStatus(profile, tool);
    checks.push({ id: `${name}:credential`, label: credential?.authenticated && !credential.expired ? "Credentials available" : credential?.expired ? "Credentials expired" : "Credentials missing", status: credential?.authenticated && !credential.expired ? "pass" : credential?.expired ? "warn" : "fail", component: "runtime", profile: name, hint: profile.authType === "oauth" ? `Run \`arc launch ${name}\` to authenticate.` : profile.authType === "api-key" ? `Run \`arc set-key ${name}\` to store your API key.` : undefined });
  } catch (err) {
    credentialError = err instanceof Error ? err.message : String(err);
    checks.push({ id: `${name}:credential`, label: "Credential check failed", status: "fail", component: "runtime", profile: name, hint: "Run `arc doctor` for detailed diagnostics." });
  }
  const adapter = getAdapter(tool);
  if (adapter?.getHealthChecks) {
    const extraChecks = await adapter.getHealthChecks(profile, name);
    for (const check of extraChecks) {
      checks.push({ id: check.key, label: check.label, status: check.status === "ok" ? "pass" : check.status, detail: check.detail ?? check.summary, component: "adapter", profile: name, tool });
    }
  }
  return { name, tool, authType: profile.authType, credential, credentialError, checks };
}

export async function collectHealthReport(): Promise<HealthReport> {
  const shellProfile = getShellProfilePath(detectShell());
  const systemChecks = [
    ...getConfigChecks(),
    getWritableDirectoryCheck(getArcDir(), "runtime:arc-dir", "ARC data directory is writable"),
    getWritableDirectoryCheck(getLogsDir(), "runtime:logs-dir", "ARC log directory is writable"),
    getPathCheck(),
    getShellIntegrationCheck(shellProfile),
  ];

  let config;
  try {
    config = loadConfig();
  } catch {
    return { configPath: getConfigPath(), systemChecks, profileReports: [], summary: summarizeHealthChecks(systemChecks), shellProfile };
  }

  const profileReports = await Promise.all(Object.entries(config.profiles).map(([name, profile]) => buildProfileReport(name, profile)));
  return {
    configPath: getConfigPath(),
    systemChecks,
    profileReports,
    summary: summarizeHealthChecks([...systemChecks, ...profileReports.flatMap((report) => report.checks)]),
    shellProfile,
  };
}
