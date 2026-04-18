// ---------------------------------------------------------------------------
// Phase 12 — Web Dashboard HTTP Server
// ---------------------------------------------------------------------------
//
// Lightweight HTTP server built on raw `node:http`. No Express dependency.
// Provides a simple route-matching pattern, static file serving, CORS
// headers, and WebSocket upgrade support.
// ---------------------------------------------------------------------------

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  DashboardOptions,
  DashboardContext,
  HttpMethod,
  Route,
  RouteHandler,
} from "./types.js";
import { createApiHandlers } from "./api.js";
import { WebSocketServer } from "./ws.js";

// ---------------------------------------------------------------------------
// MIME types for static file serving
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

// ---------------------------------------------------------------------------
// Simple router
// ---------------------------------------------------------------------------

class Router {
  private routes: Route[] = [];

  /**
   * Register a route.
   *
   * Path patterns support `:param` segments — e.g. `/api/factory/:runId`
   * is converted to a RegExp with a named capture group.
   */
  add(method: HttpMethod, pathPattern: string, handler: RouteHandler): void {
    const paramNames: string[] = [];

    // Convert `/api/factory/:runId` → `/api/factory/([^/]+)`
    const regexStr = pathPattern.replace(/:([a-zA-Z0-9_]+)/g, (_match, paramName: string) => {
      paramNames.push(paramName);
      return "([^/]+)";
    });

    this.routes.push({
      method,
      pattern: new RegExp(`^${regexStr}$`),
      paramNames,
      handler,
    });
  }

  /**
   * Find the first matching route for a given method + pathname.
   * Returns the handler and extracted params, or null.
   */
  match(
    method: string,
    pathname: string,
  ): { handler: RouteHandler; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;

      const m = route.pattern.exec(pathname);
      if (!m) continue;

      const params: Record<string, string> = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        params[route.paramNames[i]] = decodeURIComponent(m[i + 1]);
      }

      return { handler: route.handler, params };
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------

function serveStaticFile(
  res: http.ServerResponse,
  publicDir: string,
  pathname: string,
): boolean {
  let filePath = path.join(publicDir, pathname);

  // Default to index.html for directory requests.
  if (filePath.endsWith(path.sep) || filePath === publicDir) {
    filePath = path.join(filePath, "index.html");
  }

  // Ensure resolved path is still within publicDir (prevents directory traversal).
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(publicDir))) {
    return false;
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return false;

    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType, "Content-Length": stat.size });
    fs.createReadStream(resolved).pipe(res);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mutation methods that require auth
// ---------------------------------------------------------------------------

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export interface DashboardServer {
  /** Start listening. Returns a promise that resolves once the server is ready. */
  start(): Promise<void>;
  /** Gracefully shut down the HTTP server and WebSocket connections. */
  stop(): Promise<void>;
  /** The underlying node:http server instance. */
  server: http.Server;
  /** The WebSocket server for real-time push. */
  ws: WebSocketServer;
  /** API bearer token required for mutation endpoints. */
  token: string;
  /**
   * Start polling stores for changes and broadcasting updates via WebSocket.
   * Returns a cleanup function that stops the polling interval.
   */
  startPolling(intervalMs?: number): () => void;
}

export function createDashboardServer(
  options?: Partial<DashboardOptions>,
  context?: DashboardContext,
): DashboardServer {
  const port = options?.port ?? 3700;
  const host = options?.host ?? "localhost";
  const corsOrigin = options?.corsOrigin ?? `http://localhost:${port}`;
  const publicDir = options?.publicDir ?? path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "public",
  );

  // Generate a random API token for mutation endpoint authentication.
  const token = crypto.randomBytes(32).toString("hex");

  const ctx: DashboardContext = context ?? {};

  // ---- WebSocket server ---------------------------------------------------

  const wsServer = new WebSocketServer();

  // Inject ws reference into context so API handlers can broadcast.
  ctx.ws = wsServer;

  const api = createApiHandlers(ctx);

  // ---- Router setup -------------------------------------------------------

  const router = new Router();

  // GET routes
  router.add("GET", "/api/profiles", api.profiles);
  router.add("GET", "/api/health", api.health);
  router.add("GET", "/api/overview", api.overview);
  router.add("GET", "/api/sessions", api.sessions);
  router.add("GET", "/api/traces", api.traces);
  router.add("GET", "/api/risk/distribution", api.riskDistribution);
  router.add("GET", "/api/tasks", api.tasks);
  router.add("GET", "/api/skills", api.skills);
  router.add("GET", "/api/memory", api.memory);
  router.add("GET", "/api/agents", api.agents);
  router.add("GET", "/api/factory/:runId", api.factory);

  // Auth token endpoint — only accessible from localhost (GET, no auth needed)
  router.add("GET", "/api/auth/token", (_req, res) => {
    json(res, { token });
  });

  // Mutation routes
  router.add("POST", "/api/profiles/:name/switch", api.switchProfile);
  router.add("DELETE", "/api/profiles/:name", api.deleteProfile);
  router.add("POST", "/api/tasks", api.createTask);
  router.add("PATCH", "/api/tasks/:id", api.updateTask);
  router.add("POST", "/api/tasks/:id/cancel", api.cancelTask);
  router.add("POST", "/api/memory", api.addMemory);
  router.add("POST", "/api/agents", api.addAgent);

  // Chat routes (Phase 7)
  router.add("GET", "/api/chat/sessions", api.chatListSessions);
  router.add("GET", "/api/chat/sessions/:id", api.chatGetSession);
  router.add("POST", "/api/chat/message", api.chatMessage);
  router.add("POST", "/api/chat/confirm", api.chatConfirm);
  router.add("DELETE", "/api/chat/sessions/:id", api.chatDeleteSession);

  // ---- HTTP server --------------------------------------------------------

  const server = http.createServer((req, res) => {
    // CORS headers.
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // Handle preflight.
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    // Auth check: mutation endpoints require a valid Bearer token.
    if (MUTATION_METHODS.has(method) && pathname.startsWith("/api/")) {
      const authHeader = req.headers["authorization"] ?? "";
      const expected = `Bearer ${token}`;
      if (authHeader !== expected) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized — valid Bearer token required" }));
        return;
      }
    }

    // Try API routes first.
    const match = router.match(method, pathname);
    if (match) {
      try {
        const result = match.handler(req, res, match.params);
        // Handle async handlers — catch unhandled rejections.
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Internal server error" }));
            }
            // Log to stderr — don't crash.
            process.stderr.write(
              `[arc-dashboard] Unhandled error in route handler: ${err}\n`,
            );
          });
        }
        return;
      } catch (err: unknown) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
        process.stderr.write(
          `[arc-dashboard] Sync error in route handler: ${err}\n`,
        );
        return;
      }
    }

    // Try static files.
    if (publicDir && method === "GET") {
      const served = serveStaticFile(res, publicDir, pathname);
      if (served) return;

      // SPA fallback: serve index.html for non-API, non-file routes.
      const indexPath = path.join(publicDir, "index.html");
      if (fs.existsSync(indexPath) && !pathname.startsWith("/api/")) {
        const served2 = serveStaticFile(res, publicDir, "/index.html");
        if (served2) return;
      }
    }

    // 404.
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  // Wire WebSocket upgrade.
  server.on("upgrade", (req, socket, head) => {
    wsServer.handleUpgrade(req, socket, head);
  });

  // ---- start / stop -------------------------------------------------------

  return {
    server,
    ws: wsServer,
    token,

    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.removeListener("error", reject);
          wsServer.startHeartbeat();
          resolve();
        });
      });
    },

    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        wsServer.close();
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },

    startPolling(intervalMs = 3000): () => void {
      let lastCounts = { sessions: 0, tasks: 0 };

      const timer = setInterval(() => {
        const currentCounts = {
          sessions: ctx.sessions?.list()?.length ?? 0,
          tasks: ctx.tasks?.list()?.length ?? 0,
        };

        if (
          currentCounts.sessions !== lastCounts.sessions ||
          currentCounts.tasks !== lastCounts.tasks
        ) {
          wsServer.broadcast("update", currentCounts);
          lastCounts = currentCounts;
        }
      }, intervalMs);

      // Allow the timer to not hold the process open on its own.
      if (timer && typeof timer === "object" && "unref" in timer) {
        (timer as NodeJS.Timeout).unref();
      }

      return () => clearInterval(timer);
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helper — duplicated from api.ts to avoid circular imports.
// ---------------------------------------------------------------------------

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
