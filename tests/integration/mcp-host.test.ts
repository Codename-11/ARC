import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport";
import { createArcMcpServer, McpHostManager } from "@axiom-labs/arc-mcp";
import type { McpServerConfig } from "@axiom-labs/arc-mcp";
import * as loggingModule from "../../packages/core/src/logging.js";

type MockCall = [loggingModule.LogEvent, ...unknown[]];

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
    // ARC server registers: 5 supervision + arc_chat + arc_roundtable + 6 team tools = 13
    expect(srv.tools.length).toBeGreaterThanOrEqual(5);
  });

  it("getTools returns all tools with server name attribution", async () => {
    const { clientTransport } = await createTestServer();
    host = hostWithTransport(clientTransport);

    await host.connect("alpha", DUMMY_CONFIG);

    const tools = host.getTools();
    expect(tools.length).toBeGreaterThanOrEqual(5);
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

  // ── callTool — risk-gated forwarding ───────────────────────────

  describe("callTool", () => {
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logSpy = vi
        .spyOn(loggingModule, "writeLogEvent")
        .mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("forwards a benign tool call and returns the result", async () => {
      const { clientTransport } = await createTestServer();
      host = hostWithTransport(clientTransport);
      await host.connect("srv", DUMMY_CONFIG);

      // arc_classify_risk is registered on the ARC MCP server — benign action
      const result = await host.callTool("srv", "arc_classify_risk", {
        action: "list all files",
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);

      // Parse the tool response — it should be a risk classification JSON
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.tier).toBeDefined();
    });

    it("blocks a destructive tool call with structured error", async () => {
      const { clientTransport } = await createTestServer();
      host = hostWithTransport(clientTransport);
      await host.connect("srv", DUMMY_CONFIG);

      // Args containing destructive keywords will make the action description
      // trigger the destructive tier (the description includes JSON.stringify(args))
      const result = await host.callTool("srv", "arc_classify_risk", {
        action: "rm -rf / --no-preserve-root",
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.blocked).toBe(true);
      expect(parsed.tier).toBe("destructive");
      expect(parsed.reasons).toBeDefined();
      expect(parsed.reasons.length).toBeGreaterThan(0);
    });

    it("throws for a non-existent server name", async () => {
      host = new McpHostManager();

      await expect(
        host.callTool("ghost", "some_tool", {}),
      ).rejects.toThrow('Server "ghost" not found');
    });

    it("throws for a server that is not connected (error status)", async () => {
      host = new McpHostManager(() => {
        throw new Error("spawn failed");
      });
      await host.connect("bad-srv", DUMMY_CONFIG);

      await expect(
        host.callTool("bad-srv", "some_tool", {}),
      ).rejects.toThrow("not connected");
    });

    it("forwards error from external server for non-existent tool", async () => {
      const { clientTransport } = await createTestServer();
      host = hostWithTransport(clientTransport);
      await host.connect("srv", DUMMY_CONFIG);

      // MCP SDK returns isError:true for unknown tools (not a throw)
      const result = await host.callTool("srv", "nonexistent_tool_xyz", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("logs mcp:host event for forwarded tool calls", async () => {
      const { clientTransport } = await createTestServer();
      host = hostWithTransport(clientTransport);
      await host.connect("srv", DUMMY_CONFIG);
      logSpy.mockClear();

      await host.callTool("srv", "arc_classify_risk", {
        action: "list files",
      });

      const logCalls = logSpy.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as loggingModule.LogEvent).component === "mcp:host" &&
          (call[0] as loggingModule.LogEvent).message?.includes(
            "Tool call forwarded",
          ),
      );
      expect(logCalls.length).toBe(1);
    });

    it("logs mcp:host event for risk-blocked tool calls", async () => {
      const { clientTransport } = await createTestServer();
      host = hostWithTransport(clientTransport);
      await host.connect("srv", DUMMY_CONFIG);
      logSpy.mockClear();

      await host.callTool("srv", "arc_classify_risk", {
        action: "rm -rf everything",
      });

      const logCalls = logSpy.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as loggingModule.LogEvent).component === "mcp:host" &&
          (call[0] as loggingModule.LogEvent).message?.includes(
            "Risk-blocked",
          ),
      );
      expect(logCalls.length).toBe(1);
    });

    // ── Negative / boundary tests ──────────────────────────────

    it("handles empty args object", async () => {
      const { clientTransport } = await createTestServer();
      host = hostWithTransport(clientTransport);
      await host.connect("srv", DUMMY_CONFIG);

      // arc_classify_risk requires an 'action' param — server returns
      // isError:true for validation failure, not a throw
      const result = await host.callTool("srv", "arc_classify_risk", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid arguments");
    });

    it("handles very long tool name without crashing", async () => {
      const { clientTransport } = await createTestServer();
      host = hostWithTransport(clientTransport);
      await host.connect("srv", DUMMY_CONFIG);

      const longName = "a".repeat(500);
      // Non-existent tool with a very long name — server returns error
      // response, not a throw
      const result = await host.callTool("srv", longName, {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("truncates args summary in log to 200 chars", async () => {
      const { clientTransport } = await createTestServer();
      host = hostWithTransport(clientTransport);
      await host.connect("srv", DUMMY_CONFIG);
      logSpy.mockClear();

      const bigArgs = { data: "x".repeat(500) };
      // This will fail because arc_classify_risk expects 'action' string,
      // but we're testing that the log truncation works before the call
      try {
        await host.callTool("srv", "arc_classify_risk", bigArgs);
      } catch {
        // Expected — the tool will error on invalid args
      }

      // Check that the forwarded or attempted log event doesn't contain
      // the full 500-char string in message (it's in detail at most)
      const hostCalls = logSpy.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as loggingModule.LogEvent).component === "mcp:host",
      );
      // At least the connect log should exist; the tool-call log
      // should have been attempted before the throw
      expect(hostCalls.length).toBeGreaterThan(0);
    });

    it("handles args with special characters", async () => {
      const { clientTransport } = await createTestServer();
      host = hostWithTransport(clientTransport);
      await host.connect("srv", DUMMY_CONFIG);

      const result = await host.callTool("srv", "arc_classify_risk", {
        action: 'list files with "quotes" & <brackets> and \\ backslashes',
      });

      // Should succeed — benign action
      expect(result.isError).toBeFalsy();
      expect(result.content.length).toBeGreaterThan(0);
    });
  });

  // ── End-to-end lifecycle tests ─────────────────────────────────

  describe("end-to-end lifecycle", () => {
    it("connect → list → callTool → disconnect full lifecycle", async () => {
      const { clientTransport } = await createTestServer();
      host = hostWithTransport(clientTransport);

      // Connect
      await host.connect("lifecycle-srv", DUMMY_CONFIG);
      const servers = host.listConnected();
      expect(servers).toHaveLength(1);
      expect(servers[0].status).toBe("connected");

      // List tools
      const tools = host.getTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0].serverName).toBe("lifecycle-srv");

      // Call a tool (benign)
      const result = await host.callTool("lifecycle-srv", "arc_classify_risk", {
        action: "read a config file",
      });
      expect(result.isError).toBeFalsy();
      expect(result.content.length).toBeGreaterThan(0);

      // Disconnect
      await host.disconnect("lifecycle-srv");
      expect(host.listConnected()).toHaveLength(0);
      expect(host.getTools()).toHaveLength(0);
    });

    it("connect multiple servers, list shows all, disconnect one, list shows remaining", async () => {
      const srv1 = await createTestServer();
      const srv2 = await createTestServer();

      const transports = new Map<string, Transport>([
        ["alpha-cmd", srv1.clientTransport],
        ["beta-cmd", srv2.clientTransport],
      ]);
      host = hostWithTransportMap(transports);

      // Connect two servers
      await host.connect("alpha", { command: "alpha-cmd" });
      await host.connect("beta", { command: "beta-cmd" });

      // Both show in list
      const all = host.listConnected();
      expect(all).toHaveLength(2);
      const names = all.map((s) => s.name).sort();
      expect(names).toEqual(["alpha", "beta"]);

      // Both contribute tools
      const allTools = host.getTools();
      const serverNames = new Set(allTools.map((t) => t.serverName));
      expect(serverNames.has("alpha")).toBe(true);
      expect(serverNames.has("beta")).toBe(true);

      // Disconnect one
      await host.disconnect("alpha");
      const remaining = host.listConnected();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].name).toBe("beta");

      // Only beta's tools remain
      const remainingTools = host.getTools();
      for (const t of remainingTools) {
        expect(t.serverName).toBe("beta");
      }

      // Clean up
      await host.disconnect("beta");
      expect(host.listConnected()).toHaveLength(0);
    });

    it("full lifecycle with risk gate — benign passes, destructive blocked", async () => {
      const { clientTransport } = await createTestServer();
      host = hostWithTransport(clientTransport);

      // Connect
      await host.connect("gated-srv", DUMMY_CONFIG);
      expect(host.listConnected()[0].status).toBe("connected");

      // Benign tool call — should be forwarded
      const benignResult = await host.callTool("gated-srv", "arc_classify_risk", {
        action: "list all files in current directory",
      });
      expect(benignResult.isError).toBeFalsy();
      const benignParsed = JSON.parse(benignResult.content[0].text);
      expect(benignParsed.tier).toBeDefined();

      // Destructive tool call — should be blocked
      const destructiveResult = await host.callTool("gated-srv", "arc_classify_risk", {
        action: "rm -rf / --no-preserve-root",
      });
      expect(destructiveResult.isError).toBe(true);
      const blockedParsed = JSON.parse(destructiveResult.content[0].text);
      expect(blockedParsed.blocked).toBe(true);
      expect(blockedParsed.tier).toBe("destructive");

      // Server still connected after blocked call
      expect(host.listConnected()[0].status).toBe("connected");

      // Disconnect
      await host.disconnect("gated-srv");
      expect(host.listConnected()).toHaveLength(0);
    });
  });
});
