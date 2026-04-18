import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer } from "@axiom-labs/arc-mcp";

// ─── Helpers ─────────────────────────────────────────────────────────

/** Start an HTTP server on port 0 (auto-assign) and return connection details. */
async function launchServer(opts?: { authToken?: string; requireAuth?: boolean }) {
  const { server, authToken } = await startHttpServer({
    port: 0,
    ...opts,
  });
  const addr = server.address() as AddressInfo;
  const baseUrl = new URL(`http://127.0.0.1:${addr.port}/mcp`);
  return { server, authToken, baseUrl, port: addr.port };
}

/** Create a connected MCP client over HTTP transport. */
async function connectClient(
  baseUrl: URL,
  opts?: { authToken?: string },
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const headers: Record<string, string> = {};
  if (opts?.authToken) {
    headers["Authorization"] = `Bearer ${opts.authToken}`;
  }

  const transport = new StreamableHTTPClientTransport(baseUrl, {
    requestInit: { headers },
  });
  const client = new Client({ name: "test-http-client", version: "0.0.1" });
  await client.connect(transport);
  return { client, transport };
}

/** Call a tool and parse the JSON text content from the first content block. */
async function callToolJSON(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = (result as { content: { type: string; text: string }[] }).content;
  expect(content).toBeDefined();
  expect(content.length).toBeGreaterThan(0);
  expect(content[0].type).toBe("text");
  return JSON.parse(content[0].text);
}

/** Close server and suppress errors from in-flight connections. */
async function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
    // Force-close any lingering sockets so the test doesn't hang.
    server.closeAllConnections?.();
  });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("MCP HTTP Server — basic connectivity", () => {
  let server: Server;
  let authToken: string;
  let baseUrl: URL;
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    const ctx = await launchServer();
    server = ctx.server;
    authToken = ctx.authToken;
    baseUrl = ctx.baseUrl;

    // Localhost connections don't need auth by default
    const conn = await connectClient(baseUrl);
    client = conn.client;
    transport = conn.transport;
  });

  afterAll(async () => {
    try { await transport.close(); } catch { /* already closed */ }
    await closeServer(server);
  });

  it("connects via HTTP and lists tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    // Phase 6 added arc_chat, arc_roundtable, and 6 team_* tools; the 5
    // supervision tools must still be present.
    expect(names).toEqual(expect.arrayContaining([
      "arc_audit_completion",
      "arc_classify_risk",
      "arc_derive_completion",
      "arc_expand_intent",
      "arc_explain_trace",
    ]));
  });

  it("calls arc_classify_risk over HTTP", async () => {
    const result = await callToolJSON(client, "arc_classify_risk", {
      action: "deploy to production",
    });
    expect(result.tier).toBe("deploy-affecting");
    expect(result.requiresConfirmation).toBe(true);
  });
});

describe("MCP HTTP Server — all 5 tools over HTTP", () => {
  let server: Server;
  let baseUrl: URL;
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    const ctx = await launchServer();
    server = ctx.server;
    baseUrl = ctx.baseUrl;
    const conn = await connectClient(baseUrl);
    client = conn.client;
    transport = conn.transport;
  });

  afterAll(async () => {
    try { await transport.close(); } catch { /* already closed */ }
    await closeServer(server);
  });

  it("arc_classify_risk", async () => {
    const result = await callToolJSON(client, "arc_classify_risk", {
      action: "rm -rf /tmp/data",
    });
    expect(result.tier).toBe("destructive");
    expect(result.requiresConfirmation).toBe(true);
  });

  it("arc_audit_completion", async () => {
    const result = await callToolJSON(client, "arc_audit_completion", {
      response_content: "done, all tests pass",
    });
    expect(result.status).toBe("complete");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("arc_expand_intent", async () => {
    const result = await callToolJSON(client, "arc_expand_intent", {
      action: "deploy the app to production",
    });
    expect(result.risk.tier).toBe("deploy-affecting");
    expect(result.risk.requiresConfirmation).toBe(true);
  });

  it("arc_derive_completion", async () => {
    const result = await callToolJSON(client, "arc_derive_completion", {
      task_description: "1. Add login page\n2. Add validation",
      agent_response: "I added a login page with form validation.",
    });
    expect(result.score).toBeGreaterThanOrEqual(0.5);
    expect(result.criteriaCount).toBeGreaterThan(0);
  });

  it("arc_explain_trace", async () => {
    const result = await callToolJSON(client, "arc_explain_trace", {});
    expect(result.status).toBeDefined();
    expect(["ok", "empty"]).toContain(result.status);
  });
});

describe("MCP HTTP Server — auth enforcement (requireAuth: true)", () => {
  let server: Server;
  let authToken: string;
  let baseUrl: URL;

  beforeAll(async () => {
    const ctx = await launchServer({ requireAuth: true });
    server = ctx.server;
    authToken = ctx.authToken;
    baseUrl = ctx.baseUrl;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("rejects connection without auth token with 401", async () => {
    // StreamableHTTPClientTransport throws StreamableHTTPError on non-OK init response
    await expect(
      connectClient(baseUrl),
    ).rejects.toThrow();
  });

  it("rejects connection with wrong auth token", async () => {
    await expect(
      connectClient(baseUrl, { authToken: "wrong-token-value" }),
    ).rejects.toThrow();
  });

  it("succeeds with correct auth token", async () => {
    const { client, transport } = await connectClient(baseUrl, { authToken });
    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThanOrEqual(5);

      const result = await callToolJSON(client, "arc_classify_risk", {
        action: "read a file",
      });
      expect(result.tier).toBe("read-only");
    } finally {
      try { await transport.close(); } catch { /* ok */ }
    }
  });
});

describe("MCP HTTP Server — localhost auth bypass (default)", () => {
  let server: Server;
  let baseUrl: URL;

  beforeAll(async () => {
    // Default: requireAuth=false, so localhost is exempt
    const ctx = await launchServer();
    server = ctx.server;
    baseUrl = ctx.baseUrl;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("allows localhost connection without any auth token", async () => {
    const { client, transport } = await connectClient(baseUrl);
    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThanOrEqual(5);
    } finally {
      try { await transport.close(); } catch { /* ok */ }
    }
  });
});

describe("MCP HTTP Server — session lifecycle", () => {
  let server: Server;
  let baseUrl: URL;

  beforeAll(async () => {
    const ctx = await launchServer();
    server = ctx.server;
    baseUrl = ctx.baseUrl;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("creates session, calls tool, then terminates", async () => {
    const { client, transport } = await connectClient(baseUrl);

    // Verify session works
    const result = await callToolJSON(client, "arc_classify_risk", {
      action: "explain code",
    });
    expect(result.tier).toBe("read-only");

    // Close/terminate the session
    await transport.close();

    // Verify the session is gone — a new request to the old session should fail.
    // We just verify the close didn't throw; the server cleaned up internally.
  });
});

describe("MCP HTTP Server — error cases", () => {
  let server: Server;
  let baseUrl: URL;
  let port: number;

  beforeAll(async () => {
    const ctx = await launchServer();
    server = ctx.server;
    baseUrl = ctx.baseUrl;
    port = ctx.port;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("POST without session ID and non-init body returns 400", async () => {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 1,
      }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.message).toContain("Bad Request");
  });

  it("PUT to /mcp returns 405", async () => {
    const response = await fetch(baseUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(405);
  });

  it("PATCH to /mcp returns 405", async () => {
    const response = await fetch(baseUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(405);
  });

  it("GET /other returns 404", async () => {
    const otherUrl = new URL(`http://127.0.0.1:${port}/other`);
    const response = await fetch(otherUrl);
    expect(response.status).toBe(404);
  });

  it("POST with invalid JSON returns 400 parse error", async () => {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json {{{",
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.message).toContain("Parse error");
  });

  it("POST with non-existent session ID returns 404", async () => {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "mcp-session-id": "nonexistent-session-id",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 1,
      }),
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.message).toContain("Session not found");
  });
});
