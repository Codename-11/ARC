/**
 * Dashboard dev server — run with `tsx --watch` for hot-reload.
 * Usage: pnpm dev:dashboard [--port 3700]
 */

// Surface silent crashes. Without these, an unhandled rejection or uncaught
// exception in an async handler can tear the process down mid-request,
// leaving the console showing only the startup banner.
process.on("uncaughtException", (err) => {
  process.stderr.write(`\x1b[31m[dash] uncaughtException: ${err.stack ?? err}\x1b[0m\n`);
});
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`\x1b[31m[dash] unhandledRejection: ${reason instanceof Error ? reason.stack : reason}\x1b[0m\n`);
});

import { createDashboardServer } from "./server.js";
import { SessionStore } from "../../core/src/sessions.js";
import { TaskStore } from "../../core/src/tasks/index.js";
import { SkillRegistry } from "../../core/src/skills/index.js";
import { PersistentMemory } from "../../core/src/memory/index.js";
import { RemoteAgentRegistry } from "../../core/src/remote.js";

const port = parseInt(
  process.argv.find((_, i, a) => a[i - 1] === "--port") ?? "3700",
  10,
);

// Resolve public dir — handle Windows drive letter prefix from URL pathname
const rawPath = new URL("../public", import.meta.url).pathname;
const publicDir = rawPath.replace(/^\/([A-Za-z]:)/, "$1");

// Instantiate real stores backed by ~/.arc/ JSON files.
const sessions = new SessionStore();
const tasks = new TaskStore();
const skills = new SkillRegistry();
const memory = new PersistentMemory("persistent");
const remoteAgents = new RemoteAgentRegistry();

const dashboard = createDashboardServer(
  { port, host: "localhost", publicDir, corsOrigin: `http://localhost:${port}` },
  { sessions, tasks, skills, memory, remoteAgents },
);

await dashboard.start();

// Start polling stores for changes and broadcasting via WebSocket.
const stopPolling = dashboard.startPolling();

console.log(`\n  ARC Dashboard`);
console.log(`  ─────────────────────────────`);
console.log(`  Local:   http://localhost:${port}/`);
console.log(`  Token:   ${dashboard.token}`);
console.log(`  Mode:    development`);
console.log(`  Public:  ${publicDir}`);
console.log(`\n  Watching for changes...\n`);

// Graceful shutdown. Hard-exit after a short grace window so tsx --watch
// can restart us without tripping EADDRINUSE on Windows — the OS takes
// a moment to release :3700 after server.close().
let shuttingDown = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  [${sig}] shutting down...`);
    const hardExit = setTimeout(() => {
      console.log(`  [${sig}] graceful shutdown hung — forcing exit`);
      process.exit(0);
    }, 1500).unref();
    try {
      stopPolling();
      await dashboard.stop();
    } catch (err) {
      console.log(`  [${sig}] error during shutdown: ${err instanceof Error ? err.message : err}`);
    }
    clearTimeout(hardExit);
    process.exit(0);
  });
}
