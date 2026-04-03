/**
 * arc web — Launch the web dashboard server.
 */
import pc from "picocolors";
import { createDashboardServer } from "../../packages/dashboard/src/server.js";

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

  const dashboard = createDashboardServer({ port });

  try {
    await dashboard.start();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(pc.red(`Failed to start dashboard: ${msg}`) + "\n");
    process.exit(1);
  }

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
    await dashboard.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep the event loop alive
  await new Promise(() => {});
}
