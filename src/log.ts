/**
 * Simple action logger for ARC.
 * Appends timestamped entries to ~/.arc/activity.log.
 * Not for debugging — just key user actions (launch, switch, import, swap, etc.)
 */
import fs from "node:fs";
import path from "node:path";
import { getArcDir } from "./paths.js";

const MAX_LOG_LINES = 500;

function logPath(): string {
  return path.join(getArcDir(), "activity.log");
}

export function logAction(action: string, detail?: string): void {
  try {
    const dir = getArcDir();
    if (!fs.existsSync(dir)) return; // Don't create arc dir just for logging

    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    const line = detail ? `${timestamp}  ${action}  ${detail}` : `${timestamp}  ${action}`;
    fs.appendFileSync(logPath(), line + "\n", "utf-8");

    // Trim if too long (best-effort)
    try {
      const content = fs.readFileSync(logPath(), "utf-8");
      const lines = content.split("\n");
      if (lines.length > MAX_LOG_LINES + 50) {
        fs.writeFileSync(logPath(), lines.slice(-MAX_LOG_LINES).join("\n"), "utf-8");
      }
    } catch {
      // Non-critical
    }
  } catch {
    // Logging should never crash the app
  }
}
