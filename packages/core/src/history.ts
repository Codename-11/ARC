import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getArcDir } from "./paths.js";

export type LaunchOutcome = "started" | "exited" | "failed";

export interface LaunchHistoryEntry {
  profile: string;
  tool: string;
  timestamp: string;
  outcome: LaunchOutcome;
  exitCode?: number;
}

const MAX_HISTORY_ENTRIES = 200;

export function getHistoryPath(): string {
  return path.join(getArcDir(), "history.json");
}

function readHistory(): LaunchHistoryEntry[] {
  try {
    const historyPath = getHistoryPath();
    if (!fs.existsSync(historyPath)) {
      return [];
    }
    const raw = fs.readFileSync(historyPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is LaunchHistoryEntry => {
      if (typeof entry !== "object" || entry === null) return false;
      const record = entry as Record<string, unknown>;
      return (
        typeof record["profile"] === "string" &&
        typeof record["tool"] === "string" &&
        typeof record["timestamp"] === "string" &&
        typeof record["outcome"] === "string"
      );
    });
  } catch {
    return [];
  }
}

function writeHistory(entries: LaunchHistoryEntry[]): void {
  try {
    const dir = getArcDir();
    fs.mkdirSync(dir, { recursive: true });
    const historyPath = getHistoryPath();
    const tempPath = path.join(
      dir,
      `history.tmp.${crypto.randomBytes(4).toString("hex")}`
    );
    fs.writeFileSync(tempPath, JSON.stringify(entries, null, 2) + "\n", "utf-8");
    if (process.platform !== "win32") {
      fs.chmodSync(tempPath, 0o600);
    }
    fs.renameSync(tempPath, historyPath);
  } catch {
    // History writes must never crash ARC.
  }
}

export function recordLaunch(entry: LaunchHistoryEntry): void {
  try {
    const entries = readHistory();
    entries.push(entry);
    const trimmed =
      entries.length > MAX_HISTORY_ENTRIES
        ? entries.slice(entries.length - MAX_HISTORY_ENTRIES)
        : entries;
    writeHistory(trimmed);
  } catch {
    // Non-fatal.
  }
}

export function getRecentLaunches(limit = 10): LaunchHistoryEntry[] {
  const entries = readHistory();
  const reversed = [...entries].reverse();
  if (limit <= 0) return reversed;
  return reversed.slice(0, limit);
}
