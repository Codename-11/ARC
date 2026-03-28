import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface DetectedTool {
  tool: string;
  configDir: string;
  displayName: string;
}

/**
 * Known tool config locations relative to the user's home directory.
 * Each entry lists candidate files that, if present, confirm the tool is installed.
 */
const TOOL_SIGNATURES: Array<{
  tool: string;
  dirName: string;
  displayName: string;
  markerFiles: string[];
}> = [
  {
    tool: "claude",
    dirName: ".claude",
    displayName: "Claude Code",
    markerFiles: [".credentials.json", "settings.json"],
  },
  {
    tool: "gemini",
    dirName: ".gemini",
    displayName: "Gemini CLI",
    markerFiles: ["config.json", "settings.json"],
  },
  {
    tool: "codex",
    dirName: ".codex",
    displayName: "Codex CLI",
    markerFiles: ["config.json", "config.toml", "auth.json", "settings.json"],
  },
];

/**
 * Detect installed agent tool configs on the system.
 *
 * For each known tool, checks whether its config directory exists and contains
 * at least one recognised marker file.  Returns an array of detected tools,
 * ordered Claude -> Gemini -> Codex.
 */
export function detectToolConfigs(): DetectedTool[] {
  const home = os.homedir();
  const detected: DetectedTool[] = [];

  for (const sig of TOOL_SIGNATURES) {
    const configDir = path.join(home, sig.dirName);

    if (!fs.existsSync(configDir)) continue;

    const hasMarker = sig.markerFiles.some((file) =>
      fs.existsSync(path.join(configDir, file))
    );

    if (hasMarker) {
      detected.push({
        tool: sig.tool,
        configDir,
        displayName: sig.displayName,
      });
    }
  }

  return detected;
}
