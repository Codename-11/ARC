// @axiom-labs/arc-mcp — barrel exports

export { createArcMcpServer, startStdioServer } from "./server.js";
export { startHttpServer } from "./http-server.js";
export type { HttpServerOptions } from "./http-server.js";
export { registerClassifyRisk } from "./tools/classify-risk.js";
export { registerAuditCompletion } from "./tools/audit-completion.js";
export { registerExpandIntent } from "./tools/expand-intent.js";
export { registerDeriveCompletion } from "./tools/derive-completion.js";
export { registerExplainTrace } from "./tools/explain-trace.js";

// Host (client) — connect to external MCP servers
export { McpHostManager } from "./host.js";
export type {
  McpServerConfig,
  ManagedMcpServer,
  McpServerStatus,
  ToolInfo,
  TransportFactory,
  CallToolResult,
} from "./types.js";
