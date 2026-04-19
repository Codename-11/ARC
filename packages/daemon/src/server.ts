import http from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { ZodError } from "zod";
import { buildHealth } from "./health.js";
import type { DaemonConfig } from "./config.js";
import type { DB } from "./db.js";
import type { Logger } from "./logger.js";
import type { Hub } from "./hub.js";
import type { AuthFile } from "./auth.js";
import { createWsConnection } from "./ws/connection.js";
import { Session, receiveBinary } from "./ws/session.js";
import { dispatchEnvelope } from "./router.js";
import { acceptKey } from "./ws/frame.js";

export interface ServerDeps {
  config: DaemonConfig;
  db: DB;
  logger: Logger;
  hub: Hub;
  auth: AuthFile;
  version: string;
  startedAt: number;
}

export interface ServerHandle {
  httpServer: http.Server;
  close: () => Promise<void>;
  sessions: Set<Session>;
}

const ALLOWED_HOSTS = new Set<string>();
function isAllowedHost(host: string | undefined, cfgPort: number): boolean {
  if (!host) return false;
  if (ALLOWED_HOSTS.has(host)) return true;
  // accept loopback bindings with the configured port (or default 80/443 stripped)
  const [name, port] = host.split(":");
  if (!name) return false;
  const isLoopback = name === "127.0.0.1" || name === "localhost" || name === "[::1]" || name === "::1";
  if (!isLoopback) return false;
  if (!port) return true;
  return Number.parseInt(port, 10) === cfgPort;
}

export function startServer(deps: ServerDeps): ServerHandle {
  const { config, logger, hub, version, startedAt } = deps;
  const sessions = new Set<Session>();

  const httpServer = http.createServer((req, res) => {
    if (!isAllowedHost(req.headers.host, config.port)) {
      res.statusCode = 403;
      res.end("forbidden host");
      return;
    }
    const url = req.url ?? "/";
    if (req.method === "GET" && (url === "/health" || url === "/health/")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(buildHealth(version, startedAt, config.host, config.port)));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  httpServer.on("upgrade", (req, socket, head) => {
    handleUpgrade(req, socket, head, deps, sessions);
  });

  httpServer.listen(config.port, config.host, () => {
    logger.info("server.listening", { host: config.host, port: config.port });
  });

  httpServer.on("error", (err) => {
    logger.error("server.error", { message: (err as Error).message });
  });

  return {
    httpServer,
    sessions,
    close: async () => {
      for (const s of sessions) s.close(1001);
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

function handleUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  _head: Buffer,
  deps: ServerDeps,
  sessions: Set<Session>,
): void {
  const { config, logger, db, hub, auth, version, startedAt } = deps;

  if (!isAllowedHost(req.headers.host, config.port)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }
  const accept = acceptKey(key);
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"),
  );

  const conn = createWsConnection(socket);
  const session = new Session(conn);
  sessions.add(session);
  logger.info("session.open", { sessionId: session.id });

  conn.onMessage = (kind, data) => {
    if (kind !== "binary") return; // text frames ignored; protocol is binary-only
    let decoded: ReturnType<typeof receiveBinary>;
    try {
      decoded = receiveBinary(data);
    } catch (err) {
      if (err instanceof ZodError) {
        logger.warn("frame.invalid-envelope", { sessionId: session.id, issues: err.issues });
      } else {
        logger.warn("frame.decode-error", {
          sessionId: session.id,
          message: (err as Error).message,
        });
      }
      return;
    }
    if (decoded.channel === 0 && "envelope" in decoded) {
      dispatchEnvelope(session, decoded.envelope, {
        db,
        logger,
        hub,
        auth,
        version,
        startedAt,
        host: config.host,
        port: config.port,
      }).catch((err: Error) => {
        logger.error("dispatch.unhandled", { message: err.message });
      });
    }
    // Other channels (terminal/file/audio) land in later phases.
  };

  conn.onClose = () => {
    hub.detach(session);
    sessions.delete(session);
    logger.info("session.close", { sessionId: session.id });
  };
}
