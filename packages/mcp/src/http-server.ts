import { createServer, IncomingMessage, ServerResponse, Server } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { writeLogEvent } from "@axiom-labs/arc-core";

import { createArcMcpServer } from "./server.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HttpServerOptions {
  /** Port to listen on. */
  port: number;
  /** Bearer token for authentication. Auto-generated UUID if omitted. */
  authToken?: string;
  /**
   * When true, bearer auth is required even for localhost connections.
   * By default localhost is exempt from auth.
   */
  requireAuth?: boolean;
}

type AuthedRequest = IncomingMessage & { auth?: AuthInfo };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOCALHOST_ADDRESSES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

function isLocalhost(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return LOCALHOST_ADDRESSES.has(addr);
}

/** Read the entire request body into a string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** Send a JSON-RPC error response. */
function sendJsonRpcError(
  res: ServerResponse,
  httpStatus: number,
  code: number,
  message: string,
): void {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
  res.writeHead(httpStatus, { "Content-Type": "application/json" });
  res.end(body);
}

// ---------------------------------------------------------------------------
// startHttpServer
// ---------------------------------------------------------------------------

/**
 * Launch a raw `node:http` server exposing the MCP Streamable HTTP transport
 * on `/mcp`.  Each initialize handshake creates a fresh per-session
 * `McpServer` + `StreamableHTTPServerTransport` pair.
 *
 * Non-localhost connections require a valid `Authorization: Bearer <token>`
 * header (unless the caller is on localhost and `requireAuth` is false).
 */
export async function startHttpServer(
  opts: HttpServerOptions,
): Promise<{ server: Server; authToken: string }> {
  const authToken = opts.authToken ?? randomUUID();
  const requireAuth = opts.requireAuth ?? false;

  // Session map: sessionId → transport
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  // ------------------------------------------------------------------
  // Auth check – returns true if the request is authorized.
  // On failure it writes the 401 and returns false.
  // ------------------------------------------------------------------
  function authorize(req: AuthedRequest, res: ServerResponse): boolean {
    const needsAuth = requireAuth || !isLocalhost(req);
    if (!needsAuth) return true;

    const header = req.headers.authorization ?? "";
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const token = match?.[1];

    if (token !== authToken) {
      writeLogEvent({
        level: "warn",
        component: "mcp:http-server",
        message: `Auth failure from ${req.socket.remoteAddress ?? "unknown"}`,
      });
      sendJsonRpcError(res, 401, -32001, "Unauthorized: invalid or missing bearer token");
      return false;
    }

    // Populate req.auth so the SDK transport can read it.
    req.auth = {
      token,
      clientId: "arc-bearer",
      scopes: [],
    };
    return true;
  }

  // ------------------------------------------------------------------
  // Request handler
  // ------------------------------------------------------------------
  async function handleMcp(req: AuthedRequest, res: ServerResponse): Promise<void> {
    // --- Auth gate ---
    if (!authorize(req, res)) return;

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // ----- POST -----
    if (req.method === "POST") {
      // Parse body
      let rawBody: string;
      try {
        rawBody = await readBody(req);
      } catch {
        sendJsonRpcError(res, 400, -32700, "Failed to read request body");
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        sendJsonRpcError(res, 400, -32700, "Parse error: body is not valid JSON");
        return;
      }

      // Existing session
      if (sessionId && sessions.has(sessionId)) {
        const transport = sessions.get(sessionId)!;
        await transport.handleRequest(req, res, parsed);
        return;
      }

      // New session (initialize handshake)
      if (!sessionId && isInitializeRequest(parsed)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            sessions.set(sid, transport);
            writeLogEvent({
              level: "info",
              component: "mcp:http-server",
              message: `Session created: ${sid} (active=${sessions.size})`,
            });
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && sessions.has(sid)) {
            sessions.delete(sid);
            writeLogEvent({
              level: "info",
              component: "mcp:http-server",
              message: `Session closed: ${sid} (active=${sessions.size})`,
            });
          }
        };

        const server = createArcMcpServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, parsed);
        return;
      }

      // Invalid session ID → 404
      if (sessionId && !sessions.has(sessionId)) {
        sendJsonRpcError(res, 404, -32000, "Session not found");
        return;
      }

      // POST without session and not initialize
      sendJsonRpcError(res, 400, -32600, "Bad Request: missing session ID or not an initialize request");
      return;
    }

    // ----- GET / DELETE (SSE stream / session termination) -----
    if (req.method === "GET" || req.method === "DELETE") {
      if (!sessionId || !sessions.has(sessionId)) {
        sendJsonRpcError(res, 400, -32000, "Invalid or missing session ID");
        return;
      }
      const transport = sessions.get(sessionId)!;
      await transport.handleRequest(req, res);
      return;
    }

    // ----- Unsupported method -----
    res.writeHead(405, { Allow: "GET, POST, DELETE" });
    res.end();
  }

  // ------------------------------------------------------------------
  // HTTP server
  // ------------------------------------------------------------------
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Route: only /mcp
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    try {
      await handleMcp(req as AuthedRequest, res);
    } catch (err) {
      console.error("[arc-mcp:http] Unhandled error:", err);
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, "Internal server error");
      }
    }
  });

  // ------------------------------------------------------------------
  // Graceful shutdown
  // ------------------------------------------------------------------
  async function shutdown(): Promise<void> {
    console.error("[arc-mcp:http] Shutting down…");
    for (const [sid, transport] of sessions) {
      try {
        await transport.close();
      } catch (err) {
        console.error(`[arc-mcp:http] Error closing session ${sid}:`, err);
      }
    }
    sessions.clear();
    httpServer.close();
  }

  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

  // ------------------------------------------------------------------
  // Start listening
  // ------------------------------------------------------------------
  await new Promise<void>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(opts.port, () => resolve());
  });

  writeLogEvent({
    level: "info",
    component: "mcp:http-server",
    message: `Server listening on http://localhost:${opts.port}/mcp`,
  });
  console.error(`[arc-mcp:http] Listening on http://localhost:${opts.port}/mcp`);
  if (!requireAuth) {
    console.error(`[arc-mcp:http] Auth token (required for non-localhost): ${authToken}`);
  } else {
    console.error(`[arc-mcp:http] Auth token: ${authToken}`);
  }

  return { server: httpServer, authToken };
}
