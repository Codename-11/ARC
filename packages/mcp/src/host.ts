import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport";
import { writeLogEvent } from "@axiom-labs/arc-core";

import { classifyRisk } from "@axiom-labs/arc-core";

import type {
  McpServerConfig,
  ManagedMcpServer,
  ToolInfo,
  TransportFactory,
  CallToolResult,
} from "./types.js";

// ─── Default transport factory ───────────────────────────────────────

function defaultTransportFactory(config: McpServerConfig): Transport {
  if (config.command) {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    });
  }
  if (config.url) {
    const url = new URL(config.url);
    const opts: ConstructorParameters<typeof StreamableHTTPClientTransport>[1] =
      {};
    if (config.authToken) {
      opts.requestInit = {
        headers: { Authorization: `Bearer ${config.authToken}` },
      };
    }
    return new StreamableHTTPClientTransport(url, opts);
  }
  throw new Error(
    "McpServerConfig must specify either 'command' (stdio) or 'url' (HTTP)",
  );
}

// ─── Redact auth tokens from configs before logging ──────────────────

function safeConfigForLog(
  config: McpServerConfig,
): Record<string, unknown> {
  const { authToken: _redacted, ...safe } = config;
  if (_redacted) {
    (safe as Record<string, unknown>).authToken = "[REDACTED]";
  }
  return safe;
}

// ─── McpHostManager ──────────────────────────────────────────────────

/**
 * Manages connections to external MCP servers as a host (client).
 *
 * Supports dependency injection of the transport factory for testing
 * (e.g. InMemoryTransport).
 */
export class McpHostManager {
  private servers = new Map<string, ManagedMcpServer>();
  private factory: TransportFactory;

  constructor(transportFactory?: TransportFactory) {
    this.factory = transportFactory ?? defaultTransportFactory;
  }

  /**
   * Connect to an external MCP server by name.
   *
   * Creates transport → client → connects → discovers tools.
   * On failure, records status "error" with message.
   */
  async connect(name: string, config: McpServerConfig): Promise<void> {
    let transport: Transport;
    try {
      transport = this.factory(config);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      // Store a shell entry so callers can inspect the error
      this.servers.set(name, {
        name,
        config,
        client: null as unknown as Client,
        transport: null as unknown as Transport,
        status: "error",
        tools: [],
        error: message,
      });
      writeLogEvent({
        level: "error",
        component: "mcp:host",
        message: `Failed to create transport for "${name}": ${message}`,
        detail: JSON.stringify(safeConfigForLog(config)),
      });
      return;
    }

    const client = new Client({ name: "arc-host", version: "0.1.0" });

    // Tentative entry — status "connecting"
    const entry: ManagedMcpServer = {
      name,
      config,
      client,
      transport,
      status: "connecting",
      tools: [],
    };
    this.servers.set(name, entry);

    try {
      await client.connect(transport);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      entry.status = "error";
      entry.error = message;
      writeLogEvent({
        level: "error",
        component: "mcp:host",
        message: `Connection to "${name}" failed: ${message}`,
        detail: JSON.stringify(safeConfigForLog(config)),
      });
      return;
    }

    // Discover tools
    try {
      const { tools } = await client.listTools();
      entry.tools = tools.map(
        (t): ToolInfo => ({
          name: t.name,
          description: t.description ?? "",
          inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
        }),
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      entry.status = "error";
      entry.error = `Connected but tool discovery failed: ${message}`;
      writeLogEvent({
        level: "warn",
        component: "mcp:host",
        message: `Tool discovery failed for "${name}": ${message}`,
      });
      return;
    }

    entry.status = "connected";
    writeLogEvent({
      level: "info",
      component: "mcp:host",
      message: `Connected to "${name}" — ${entry.tools.length} tool(s) discovered`,
      detail: JSON.stringify({
        server: name,
        config: safeConfigForLog(config),
        tools: entry.tools.map((t) => t.name),
      }),
    });
  }

  /**
   * Disconnect a managed server by name.
   * No-op if the server isn't tracked.
   */
  async disconnect(name: string): Promise<void> {
    const entry = this.servers.get(name);
    if (!entry) return;

    try {
      if (entry.client && entry.status === "connected") {
        await entry.client.close();
      }
    } catch {
      // Best-effort close — don't throw on cleanup
    }

    entry.status = "disconnected";
    this.servers.delete(name);

    writeLogEvent({
      level: "info",
      component: "mcp:host",
      message: `Disconnected from "${name}"`,
    });
  }

  /** Disconnect all managed servers. */
  async disconnectAll(): Promise<void> {
    const names = [...this.servers.keys()];
    await Promise.all(names.map((n) => this.disconnect(n)));
  }

  /** Return all tracked servers (including errored ones). */
  listConnected(): ManagedMcpServer[] {
    return [...this.servers.values()];
  }

  /** Aggregate tools across all connected servers with server attribution. */
  getTools(): { serverName: string; tool: ToolInfo }[] {
    const result: { serverName: string; tool: ToolInfo }[] = [];
    for (const entry of this.servers.values()) {
      if (entry.status !== "connected") continue;
      for (const tool of entry.tools) {
        result.push({ serverName: entry.name, tool });
      }
    }
    return result;
  }

  /**
   * Call a tool on a connected external MCP server with risk classification gate.
   *
   * Builds an action description, runs classifyRisk(). If the tier is
   * "destructive", blocks the call and returns a structured error. Otherwise
   * forwards to the external server and returns the result.
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const entry = this.servers.get(serverName);
    if (!entry) {
      throw new Error(
        `Server "${serverName}" not found. Connected servers: [${[...this.servers.keys()].join(", ")}]`,
      );
    }
    if (entry.status !== "connected") {
      throw new Error(
        `Server "${serverName}" is not connected (status: ${entry.status})`,
      );
    }

    // Build action description with truncated args for log safety
    const argsSummary = JSON.stringify(args);
    const truncatedArgs =
      argsSummary.length > 200
        ? argsSummary.slice(0, 200) + "…"
        : argsSummary;
    const actionDescription = `Call tool '${toolName}' on external MCP server '${serverName}' with args: ${truncatedArgs}`;

    // Risk classification gate
    const risk = classifyRisk(actionDescription);

    if (risk.tier === "destructive") {
      writeLogEvent({
        level: "warn",
        component: "mcp:host",
        message: `Risk-blocked tool call: "${toolName}" on "${serverName}" — tier: ${risk.tier}`,
        detail: JSON.stringify({
          server: serverName,
          tool: toolName,
          tier: risk.tier,
          reasons: risk.reasons,
        }),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              blocked: true,
              tier: risk.tier,
              reasons: risk.reasons,
            }),
          },
        ],
        isError: true,
      };
    }

    // Forward to external server
    const result = await entry.client.callTool({
      name: toolName,
      arguments: args,
    });

    writeLogEvent({
      level: "info",
      component: "mcp:host",
      message: `Tool call forwarded: "${toolName}" on "${serverName}" — tier: ${risk.tier}`,
      detail: JSON.stringify({
        server: serverName,
        tool: toolName,
        tier: risk.tier,
      }),
    });

    return result as CallToolResult;
  }
}
