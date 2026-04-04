#!/usr/bin/env node
// Kill stale dev processes (tsx, vite, vitepress, serve) before starting fresh ones.
// Usage: node scripts/kill-stale.js [filter...]
//   No args = kill all dev processes (tsx, vite, vitepress)
//   With args = kill only matching (e.g. "tsx" or "vite")

import { execSync } from "child_process";

const filters = process.argv.slice(2);
const targets = filters.length > 0 ? filters : ["tsx", "vite", "vitepress"];

const isWin = process.platform === "win32";

for (const name of targets) {
  try {
    if (isWin) {
      // taskkill by image name — /F force, /T tree kill
      // tsx/vite/vitepress all run as node.exe, so match by command line
      execSync(
        `wmic process where "CommandLine like '%${name}%' and not CommandLine like '%kill-stale%'" get ProcessId 2>nul`,
        { encoding: "utf-8" }
      )
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^\d+$/.test(l))
        .forEach((pid) => {
          try { execSync(`taskkill /PID ${pid} /F /T 2>nul`); } catch {}
        });
    } else {
      execSync(`pkill -f "${name}" 2>/dev/null || true`);
    }
  } catch {
    // No matching processes — fine
  }
}
