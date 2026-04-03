import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function detectClaudeConfig() {
  const configDir = path.join(os.homedir(), ".claude");
  if (!fs.existsSync(configDir)) {
    return null;
  }

  const hasMarker = [".credentials.json", "settings.json"].some((file) =>
    fs.existsSync(path.join(configDir, file))
  );

  if (!hasMarker) {
    return null;
  }

  return {
    tool: "claude",
    configDir,
    displayName: "Claude Code",
  };
}
