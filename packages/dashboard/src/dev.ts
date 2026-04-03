/**
 * Dashboard dev server — run with `tsx --watch` for hot-reload.
 * Usage: pnpm dev:dashboard [--port 3700]
 */
import { createDashboardServer } from "./server.js";

const port = parseInt(
  process.argv.find((_, i, a) => a[i - 1] === "--port") ?? "3700",
  10,
);

// Resolve public dir — handle Windows drive letter prefix from URL pathname
const rawPath = new URL("../public", import.meta.url).pathname;
const publicDir = rawPath.replace(/^\/([A-Za-z]:)/, "$1");

const { start, stop } = createDashboardServer(
  { port, host: "localhost", publicDir, corsOrigin: "*" },
);

await start();

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
    await stop();
    process.exit(0);
  });
}
