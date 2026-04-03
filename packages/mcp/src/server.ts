import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeLogEvent } from "@axiom-labs/arc-core";

import { registerClassifyRisk } from "./tools/classify-risk.js";
import { registerAuditCompletion } from "./tools/audit-completion.js";
import { registerExpandIntent } from "./tools/expand-intent.js";
import { registerDeriveCompletion } from "./tools/derive-completion.js";
import { registerExplainTrace } from "./tools/explain-trace.js";

const SERVER_NAME = "arc-supervision";
const SERVER_VERSION = "0.1.0";

/**
 * Create an MCP server with all 5 ARC supervision tools registered.
 *
 * Returns the server instance (not yet connected to any transport).
 */
export function createArcMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Register all supervision tools
  registerClassifyRisk(server);
  registerAuditCompletion(server);
  registerExpandIntent(server);
  registerDeriveCompletion(server);
  registerExplainTrace(server);

  return server;
}

/**
 * Create and start the MCP server with stdio transport.
 *
 * This is the main entry point for `arc mcp serve`.
 * Logs server lifecycle events to ARC's structured log.
 */
export async function startStdioServer(): Promise<void> {
  writeLogEvent({
    level: "info",
    component: "mcp:server",
    message: `Starting ${SERVER_NAME} v${SERVER_VERSION} on stdio transport`,
  });

  const server = createArcMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Log to stderr so it doesn't interfere with JSON-RPC on stdout
  console.error(`[arc-mcp] ${SERVER_NAME} v${SERVER_VERSION} running on stdio`);

  writeLogEvent({
    level: "info",
    component: "mcp:server",
    message: "Server connected and ready",
  });
}
