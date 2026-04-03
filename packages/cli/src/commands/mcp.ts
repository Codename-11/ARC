import type { Command } from "commander";

/**
 * Register the `arc mcp` command group with the `serve` subcommand.
 *
 * `arc mcp serve` starts the MCP supervision server.
 * Supports `stdio` (default) and `http` transports.
 */
export function registerMcpCommand(program: Command): void {
  const mcp = program
    .command("mcp")
    .description("MCP supervision server for agent tool integration");

  mcp
    .command("serve")
    .description("Start the ARC MCP supervision server")
    .option("--transport <type>", "Transport type: stdio or http", "stdio")
    .option("--port <number>", "HTTP port (only with --transport http)", "3100")
    .option("--auth-token <token>", "Bearer auth token (only with --transport http)")
    .option("--require-auth", "Require auth even for localhost (only with --transport http)", false)
    .action(async (opts: {
      transport: string;
      port: string;
      authToken?: string;
      requireAuth: boolean;
    }) => {
      const transport = opts.transport;

      if (transport !== "stdio" && transport !== "http") {
        console.error(`[arc-mcp] Unsupported transport: "${transport}". Use "stdio" or "http".`);
        process.exit(1);
      }

      if (transport === "stdio") {
        // Validate no HTTP-only options used with stdio
        // Commander sets port default to "3100" always, so only check explicit auth options
        if (opts.authToken !== undefined) {
          console.error("[arc-mcp] --auth-token is only valid with --transport http");
          process.exit(1);
        }
        if (opts.requireAuth) {
          console.error("[arc-mcp] --require-auth is only valid with --transport http");
          process.exit(1);
        }

        const { startStdioServer } = await import("@axiom-labs/arc-mcp");
        await startStdioServer();
        return;
      }

      // --- HTTP transport ---
      const port = Number(opts.port);
      if (!Number.isFinite(port) || port < 0 || port > 65535) {
        console.error(`[arc-mcp] Invalid port: "${opts.port}". Must be a number between 0 and 65535.`);
        process.exit(1);
      }

      const { startHttpServer } = await import("@axiom-labs/arc-mcp");
      await startHttpServer({
        port,
        authToken: opts.authToken,
        requireAuth: opts.requireAuth,
      });
    });
}
