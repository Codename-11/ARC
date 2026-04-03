import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport";
import { createArcMcpServer, McpHostManager } from "@axiom-labs/arc-mcp";
import type { McpServerConfig } from "@axiom-labs/arc-mcp";

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Create a test MCP server backed by InMemoryTransport.
 *
 * Returns the "client-side" transport that should be injected into the
 * McpHostManager's transport factory, plus the server instance for cleanup.
 */
async function createTestServer() {
  const server = createArcMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // The server connects to its side of the pair
  await server.connect(serverTransport);

  return { server, clientTransport, serverTransport };
}

/**
 * Build a McpHostManager whose transport factory returns the given transport
 * for any config. Useful for injecting InMemoryTransport in tests.
 */
function hostWithTransport(transport: Transport): McpHostManager {
  return new McpHostManager(() => transport);
}

/**
 * Build a McpHostManager whose transport factory returns transports
 * from a map keyed by server name (matched via config.command).
 */
function hostWithTransportMap(
  transportMap: Map<string, Transport>,
): McpHostManager {
  return new McpHostManager((config: McpServerConfig) => {
    const t = transportMap.get(config.command ?? "");
    if (!t) throw new Error(`No transport for command "${config.command}"`);
    return t;
  });
}

// Dummy config — the actual transport is injected, so these values are ignored
const DUMMY_CONFIG: McpServerConfig = { command: "dummy-server" };

// ─── Tests ───────────────────────────────────────────────────────────

describe("McpHostManager", () => {
  let host: McpHostManager;

  afterEach(async () => {
    if (host) await host.disconnectAll();
  });

  // ── Connection lifecycle ───────────────────────────────────────

  it("connects to a test server and discovers tools", async () => {
    const { clientTransport } = await createTestServer();
    host = hostWithTransport(clientTransport);

    await host.connect("test-srv", DUMMY_CONFIG);

    const servers = host.listConnected();
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("test-srv");
    expect(servers[0].status).toBe("connected");
    expect(servers[0].tools.length).toBeGreaterThan(0);
  });

  it("listConnected returns server with correct name and tool count", async () => {
    const { clientTransport } = await createTestServer();
    host = hostWithTransport(clientTransport);

    await host.connect("my-server", DUMMY_CONFIG);

    const [srv] = host.listConnected();
    expect(srv.name).toBe("my-server");
    // ARC supervision server registers 5 tools
    expect(srv.tools).toHaveLength(5);
  });

  it("getTools returns all tools with server name attribution", async () => {
    const { clientTransport } = await createTestServer();
    host = hostWithTransport(clientTransport);

    await host.connect("alpha", DUMMY_CONFIG);

    const tools = host.getTools();
    expect(tools.length).toBe(5);
    for (const entry of tools) {
      expect(entry.serverName).toBe("alpha");
      expect(entry.tool.name).toBeTruthy();
      expect(typeof entry.tool.description).toBe("string");
      expect(entry.tool.inputSchema).toBeDefined();
    }
  });

  it("disconnect removes server from listConnected", async () => {
    const { clientTransport } = await createTestServer();
    host = hostWithTransport(clientTransport);

    await host.connect("to-remove", DUMMY_CONFIG);
    expect(host.listConnected()).toHaveLength(1);

    await host.disconnect("to-remove");
    expect(host.listConnected()).toHaveLength(0);
  });

  it("disconnectAll disconnects multiple servers", async () => {
    const srv1 = await createTestServer();
    const srv2 = await createTestServer();

    const transports = new Map<string, Transport>([
      ["server-a", srv1.clientTransport],
      ["server-b", srv2.clientTransport],
    ]);
    host = hostWithTransportMap(transports);

    await host.connect("srv-a", { command: "server-a" });
    await host.connect("srv-b", { command: "server-b" });
    expect(host.listConnected()).toHaveLength(2);

    await host.disconnectAll();
    expect(host.listConnected()).toHaveLength(0);
  });

  // ── Error handling ─────────────────────────────────────────────

  it("sets status to error when transport factory throws", async () => {
    host = new McpHostManager(() => {
      throw new Error("spawn failed");
    });

    await host.connect("bad-srv", DUMMY_CONFIG);

    const servers = host.listConnected();
    expect(servers).toHaveLength(1);
    expect(servers[0].status).toBe("error");
    expect(servers[0].error).toContain("spawn failed");
  });

  it("sets status to error when client.connect rejects", async () => {
    // Create a transport whose start() rejects
    const brokenTransport: Transport = {
      start: () => Promise.reject(new Error("connection refused")),
      send: () => Promise.resolve(),
      close: () => Promise.resolve(),
    };

    host = hostWithTransport(brokenTransport);
    await host.connect("broken", DUMMY_CONFIG);

    const [srv] = host.listConnected();
    expect(srv.status).toBe("error");
    expect(srv.error).toContain("connection refused");
  });

  // ── Boundary conditions ────────────────────────────────────────

  it("disconnect on unknown server is a no-op", async () => {
    host = new McpHostManager();
    // Should not throw
    await host.disconnect("nonexistent");
    expect(host.listConnected()).toHaveLength(0);
  });

  it("getTools with zero servers returns empty array", async () => {
    host = new McpHostManager();
    expect(host.getTools()).toEqual([]);
  });
});
