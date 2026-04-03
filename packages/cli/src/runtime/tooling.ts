import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";

export function findBinary(name: string): boolean {
  const result = isWindows
    ? spawnSync("cmd", ["/c", "where", name], { stdio: "ignore" })
    : spawnSync("which", [name], { stdio: "ignore" });
  return result.status === 0;
}

export function getInstallHint(tool: string): string {
  switch (tool) {
    case "claude":
      return "Install with: npm install -g @anthropic-ai/claude-code";
    case "gemini":
      return "See Google's documentation for Gemini CLI installation instructions.";
    case "codex":
      return "Install with: npm install -g @openai/codex";
    default:
      return `Ensure "${tool}" is installed and available on your PATH.`;
  }
}
