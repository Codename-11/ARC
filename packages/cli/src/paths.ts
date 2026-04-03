export * from "../../core/src/paths.js";
import os from "node:os";
import path from "node:path";
import { getSharedDir } from "../../core/src/paths.js";

export function getClaudeDefaultDir(): string {
  return path.join(os.homedir(), ".claude");
}

export function getSharedClaudeMdPath(): string {
  return path.join(getSharedDir(), "CLAUDE.md");
}
