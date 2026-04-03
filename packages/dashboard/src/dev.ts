/**
 * Dashboard dev server — run with `tsx --watch` for hot-reload.
 * Usage: pnpm dev:dashboard [--port 3700]
 */
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
  { port, host: "localhost", publicDir, corsOrigin: "*" },
  { sessions, tasks, skills, memory, remoteAgents },
);

await dashboard.start();

// Start polling stores for changes and broadcasting via WebSocket.
const stopPolling = dashboard.startPolling();

console.log(`\n  ARC Dashboard`);
console.log(`  ─────────────────────────────`);
console.log(`  Local:   http://localhost:${port}/`);
console.log(`  Mode:    development`);
console.log(`  Public:  ${publicDir}`);
console.log(`\n  Watching for changes...\n`);

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    console.log(`\n  [${sig}] shutting down...`);
    stopPolling();
    await dashboard.stop();
    process.exit(0);
  });
}
