export * from "@axiom-labs/arc-core";
import os from "node:os";
import path from "node:path";
import { getSharedDir } from "@axiom-labs/arc-core";

export function getClaudeDefaultDir(): string {
  return path.join(os.homedir(), ".claude");
}

export function getSharedClaudeMdPath(): string {
  return path.join(getSharedDir(), "CLAUDE.md");
}
