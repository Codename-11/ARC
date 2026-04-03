import type { Client } from "@modelcontextprotocol/sdk/client";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

// ─── External MCP server configuration ───────────────────────────────

/**
 * Configuration for connecting to an external MCP server.
 *
 * Exactly one transport mode must be specified:
 * - stdio: set `command` (and optionally `args`, `env`)
 * - HTTP:  set `url` (and optionally `authToken`)
 */
export interface McpServerConfig {
  /** Executable path for stdio transport. */
  command?: string;
  /** Arguments passed to the stdio command. */
  args?: string[];
  /** Environment variables for the stdio process. */
  env?: Record<string, string>;
  /** URL for StreamableHTTP transport. */
  url?: string;
  /** Auth token for HTTP transport (never logged). */
  authToken?: string;
}

// ─── Connection status ───────────────────────────────────────────────

export type McpServerStatus = "connecting" | "connected" | "disconnected" | "error";

// ─── Tool metadata ───────────────────────────────────────────────────

/** Flattened tool info returned by MCP server discovery. */
export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ─── Managed server state ────────────────────────────────────────────

/** Runtime state for a connected (or failed) external MCP server. */
export interface ManagedMcpServer {
  name: string;
  config: McpServerConfig;
  client: Client;
  transport: Transport;
  status: McpServerStatus;
  tools: ToolInfo[];
  /** Error message when status is "error". */
  error?: string;
}

// ─── Tool call result ────────────────────────────────────────────────

/**
 * Simplified CallToolResult matching the essential MCP SDK shape.
 * Used as the return type for McpHostManager.callTool().
 */
export interface CallToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/** Transport factory signature used by McpHostManager for DI. */
export type TransportFactory = (config: McpServerConfig) => Transport;
