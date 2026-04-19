#!/usr/bin/env node
import { Command } from "commander";
import { startRelay } from "./index.js";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("arc-relay")
    .description(
      "ARC relay — stateless WebSocket multiplexer that routes opaque bytes between paired endpoints.",
    );

  program
    .command("start")
    .description("Start the relay server")
    .option("-p, --port <port>", "TCP port to bind", "8765")
    .option("-H, --host <host>", "Host/interface to bind", "0.0.0.0")
    .action(async (opts: { port: string; host: string }) => {
      const port = Number.parseInt(opts.port, 10);
      if (!Number.isFinite(port) || port < 0 || port > 65535) {
        process.stderr.write(`invalid port: ${opts.port}\n`);
        process.exit(2);
      }
      const handle = await startRelay({ port, host: opts.host });
      process.stdout.write(
        `arc-relay listening on ws://${handle.host}:${handle.port} (health at /health)\n`,
      );

      const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
        process.stdout.write(`\narc-relay received ${signal}, shutting down...\n`);
        try {
          await handle.stop();
        } finally {
          process.exit(0);
        }
      };
      process.once("SIGINT", () => void shutdown("SIGINT"));
      process.once("SIGTERM", () => void shutdown("SIGTERM"));
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  process.stderr.write(`arc-relay: ${(err as Error).message}\n`);
  process.exit(1);
});
