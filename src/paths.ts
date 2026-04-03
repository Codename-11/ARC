import os from "node:os";
import path from "node:path";

export function getArcDir(): string {
  const envDir = process.env["ARC_DIR"];
  if (envDir) {
    return envDir;
  }
  return path.join(os.homedir(), ".arc");
}

export function getConfigPath(): string {
  return path.join(getArcDir(), "config.json");
}

export function getProfilesDir(): string {
  return path.join(getArcDir(), "profiles");
}

export function getProfileDir(name: string): string {
  return path.join(getArcDir(), "profiles", name);
}

export function getSharedDir(): string {
  return path.join(getArcDir(), "shared");
}

export function getSharedSettingsPath(): string {
  return path.join(getSharedDir(), "settings.json");
}

export function getSharedCommandsDir(): string {
  return path.join(getSharedDir(), "commands");
}

export function getSharedClaudeMdPath(): string {
  return path.join(getSharedDir(), "CLAUDE.md");
}

export function getSharedMemoryDir(): string {
  return path.join(getSharedDir(), "memory");
}

export function getSharedProjectsDir(): string {
  return path.join(getSharedDir(), "projects");
}

export function getLogsDir(): string {
  return path.join(getArcDir(), "logs");
}

export function getStructuredLogPath(): string {
  return path.join(getLogsDir(), "events.ndjson");
}

export function getClaudeDefaultDir(): string {
  return path.join(os.homedir(), ".claude");
}

/** @deprecated Use getArcDir */
export const getMulticcDir = getArcDir;
