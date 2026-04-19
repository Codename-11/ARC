#!/usr/bin/env node
// Kill stale dev processes (tsx, vite, vitepress, serve) before starting fresh ones.
// Usage: node scripts/kill-stale.js [filter...] [--port <n>]
//   No args = kill all dev processes (tsx, vite, vitepress)
//   With args = kill only matching (e.g. "tsx" or "vite")
//   --port <n> = additionally free any process holding TCP port n

import { execSync } from "child_process";

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx >= 0 ? args[portIdx + 1] : null;
const filters = args.filter((a, i) => a !== "--port" && args[i - 1] !== "--port");
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

// Port-specific cleanup — catches zombie servers tsx didn't spawn.
if (port && /^\d+$/.test(port)) {
  try {
    if (isWin) {
      const netstat = execSync(`netstat -ano -p tcp 2>nul`, { encoding: "utf-8" });
      const pids = new Set();
      for (const line of netstat.split(/\r?\n/)) {
        if (line.includes(`:${port} `) && /LISTENING/.test(line)) {
          const m = line.match(/(\d+)\s*$/);
          if (m) pids.add(m[1]);
        }
      }
      for (const pid of pids) {
        try { execSync(`taskkill /PID ${pid} /F 2>nul`); } catch {}
      }
    } else {
      execSync(`lsof -ti:${port} 2>/dev/null | xargs -r kill -9 2>/dev/null || true`);
    }
  } catch {
    // Port not in use — fine
  }
}
