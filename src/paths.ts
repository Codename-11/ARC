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

export function getClaudeDefaultDir(): string {
  return path.join(os.homedir(), ".claude");
}

/** @deprecated Use getArcDir */
export const getMulticcDir = getArcDir;
