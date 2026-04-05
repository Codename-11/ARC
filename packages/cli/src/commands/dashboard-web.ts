/**
 * arc web — Launch the web dashboard server.
 */
import pc from "picocolors";
import { createDashboardServer } from "../../../dashboard/src/server.js";
import { SessionStore } from "@axiom-labs/arc-core";
import { TaskStore } from "@axiom-labs/arc-core";
import { SkillRegistry } from "@axiom-labs/arc-core";
import { PersistentMemory } from "@axiom-labs/arc-core";
import { RemoteAgentRegistry } from "@axiom-labs/arc-core";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleDashboardWeb(opts: {
  port?: string | number;
}): Promise<void> {
  const port = typeof opts.port === "string" ? Number.parseInt(opts.port, 10) : (opts.port ?? 3700);

  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    process.stderr.write(pc.red(`Invalid port: ${opts.port}`) + "\n");
    process.exit(1);
  }

  // Resolve the dashboard public directory relative to this file's location.
  const rawPublicDir = new URL(
    "../../../dashboard/public",
    import.meta.url,
  ).pathname;
  const publicDir = rawPublicDir.replace(/^\/([A-Za-z]:)/, "$1");

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

  try {
    await dashboard.start();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(pc.red(`Failed to start dashboard: ${msg}`) + "\n");
    process.exit(1);
  }

  // Start polling stores for changes and broadcasting via WebSocket.
  const stopPolling = dashboard.startPolling();

  const url = `http://localhost:${port}`;

  process.stdout.write("\n");
  process.stdout.write(pc.bold("  ARC Web Dashboard") + "\n");
  process.stdout.write(`  ${pc.dim("Running at")} ${pc.cyan(pc.bold(url))}\n`);
  process.stdout.write(pc.dim("  Press Ctrl+C to stop.\n"));
  process.stdout.write("\n");

  // Try to open in default browser
  try {
    const { exec } = await import("node:child_process");
    const openCmd = process.platform === "win32"
      ? `start ${url}`
      : process.platform === "darwin"
        ? `open ${url}`
        : `xdg-open ${url}`;
    exec(openCmd);
  } catch {
    // Silently ignore — not critical
  }

  // Keep process alive and handle graceful shutdown
  const shutdown = async () => {
    process.stdout.write(pc.dim("\n  Shutting down...\n"));
    stopPolling();
    await dashboard.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep the event loop alive
  await new Promise(() => {});
}
