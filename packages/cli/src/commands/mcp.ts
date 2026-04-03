import type { Command } from "commander";

/**
 * Register the `arc mcp` command group with the `serve` subcommand.
 *
 * `arc mcp serve` starts the MCP supervision server over stdio transport.
 * The stdio transport is the default (and only option in this release).
 */
export function registerMcpCommand(program: Command): void {
  const mcp = program
    .command("mcp")
    .description("MCP supervision server for agent tool integration");

  mcp
    .command("serve")
    .description("Start the ARC MCP supervision server (stdio transport)")
    .option("--transport <type>", "Transport type (stdio)", "stdio")
    .action(async (opts: { transport: string }) => {
      if (opts.transport !== "stdio") {
        console.error(`[arc-mcp] Unsupported transport: "${opts.transport}". Only "stdio" is supported.`);
        process.exit(1);
      }

      const { startStdioServer } = await import("@axiom-labs/arc-mcp");
      await startStdioServer();
    });
}
