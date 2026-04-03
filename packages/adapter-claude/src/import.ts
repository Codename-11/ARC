import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function importClaudeArtifacts(sourceDir: string, targetDir: string): string[] {
  const copied: string[] = [];
  const claudeJsonInSource = path.join(sourceDir, ".claude.json");
  const claudeJsonInHome = path.join(os.homedir(), ".claude.json");
  const source = fs.existsSync(claudeJsonInSource)
    ? claudeJsonInSource
    : fs.existsSync(claudeJsonInHome)
      ? claudeJsonInHome
      : null;

  if (source) {
    fs.copyFileSync(source, path.join(targetDir, ".claude.json"));
    copied.push(".claude.json");
  }

  return copied;
}
