import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";

/**
 * Relay options.
 */
export interface RelayOptions {
  /** TCP port to bind. */
  port: number;
  /** Host/interface to bind. Defaults to "0.0.0.0". */
  host?: string;
  /**
   * Max time in ms a pair may sit with only one side connected before the
   * lone socket is evicted and the pair entry is deleted.
   *
   * Defaults to 5 minutes. Exposed primarily for tests.
   */
  pairTtlMs?: number;
  /**
   * How often the sweeper runs to enforce `pairTtlMs`. Defaults to 30s.
   */
  sweepIntervalMs?: number;
}

/**
 * Handle returned by `startRelay`.
 */
export interface RelayHandle {
  /** Bound port (useful when callers pass `port: 0`). */
  port: number;
  /** Bound host. */
  host: string;
  /** Graceful shutdown. Closes all sockets then the HTTP server. */
  stop: () => Promise<void>;
}

interface Pair {
  pairCode: string;
  a?: WebSocket;
  b?: WebSocket;
  createdAt: number;
}

const OptionsSchema = z.object({
  port: z.number().int().nonnegative(),
  host: z.string().min(1).optional(),
  pairTtlMs: z.number().int().positive().optional(),
  sweepIntervalMs: z.number().int().positive().optional(),
});

const DEFAULT_PAIR_TTL_MS = 5 * 60_000;
const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

/**
 * Start a stateless pair-mux relay.
 *
 * Protocol:
 *   - Client connects via WebSocket to `/?pair=<code>`.
 *   - First connection with a given `<code>` becomes side `a`.
 *   - Second connection with that same `<code>` becomes side `b`.
 *   - Any further connection for that `<code>` is rejected (pair is full).
 *   - Binary frames received on one side are forwarded verbatim to the other.
 *   - Text frames are dropped (payloads are opaque ciphertext, not text).
 *   - When either side closes, the other is closed and the pair is deleted.
 *   - Pairs that sit with only one side connected beyond `pairTtlMs` are
 *     swept: the lone socket is closed and the entry removed.
 *
 * The relay is intentionally zero-knowledge: it never inspects, decrypts,
 * or logs payload content.
 */
export async function startRelay(opts: RelayOptions): Promise<RelayHandle> {
  const parsed = OptionsSchema.parse(opts);
  const host = parsed.host ?? "0.0.0.0";
  const pairTtlMs = parsed.pairTtlMs ?? DEFAULT_PAIR_TTL_MS;
  const sweepIntervalMs = parsed.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;

  const pairs = new Map<string, Pair>();

  const httpServer = http.createServer((req, res) => {
    // Tiny liveness endpoint. Everything else is WS.
    if (req.method === "GET" && (req.url === "/health" || req.url === "/health/")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, pairs: pairs.size }));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    let url: URL;
    try {
      // Host header is irrelevant for routing; synthesize one.
      url = new URL(req.url ?? "/", "http://relay.local");
    } catch {
      rejectUpgrade(socket, 400, "bad request");
      return;
    }
    const pairCode = url.searchParams.get("pair");
    if (!pairCode || pairCode.length < 1 || pairCode.length > 256) {
      rejectUpgrade(socket, 400, "missing or invalid pair code");
      return;
    }

    const existing = pairs.get(pairCode);
    if (existing && existing.a && existing.b) {
      rejectUpgrade(socket, 409, "pair is full");
      return;
    }

    wss.handleUpgrade(req, socket as never, head, (ws) => {
      attach(ws, pairCode);
    });
  });

  function attach(ws: WebSocket, pairCode: string): void {
    let pair = pairs.get(pairCode);
    if (!pair) {
      pair = { pairCode, createdAt: Date.now() };
      pairs.set(pairCode, pair);
    }

    let side: "a" | "b";
    if (!pair.a) {
      pair.a = ws;
      side = "a";
    } else if (!pair.b) {
      pair.b = ws;
      side = "b";
    } else {
      // Defensive: the upgrade handler already rejects full pairs; this only
      // fires if the gate is bypassed (e.g. internal caller).
      try {
        ws.close(1013, "pair is full");
      } catch {
        // ignore
      }
      return;
    }

    const forward = (data: unknown, isBinary: boolean): void => {
      if (!isBinary) return; // drop text frames
      const peer = side === "a" ? pair!.b : pair!.a;
      if (!peer || peer.readyState !== peer.OPEN) return;
      // `data` from ws is a Buffer (or array of Buffers) by default. Pass binary.
      peer.send(data as Buffer, { binary: true }, () => {
        // Errors during forwarding close the peer; we silently drop.
      });
    };

    const teardown = (reason: number = 1000): void => {
      const current = pairs.get(pairCode);
      if (!current) return;
      const peer = side === "a" ? current.b : current.a;
      pairs.delete(pairCode);
      if (peer && peer.readyState === peer.OPEN) {
        try {
          peer.close(reason, "peer disconnected");
        } catch {
          // ignore
        }
      }
    };

    ws.on("message", forward);
    ws.once("close", () => teardown(1000));
    ws.once("error", () => {
      try {
        ws.close(1011, "socket error");
      } catch {
        // ignore
      }
      teardown(1011);
    });
  }

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [code, pair] of pairs) {
      const bothConnected =
        pair.a && pair.a.readyState === pair.a.OPEN && pair.b && pair.b.readyState === pair.b.OPEN;
      if (bothConnected) continue;
      if (now - pair.createdAt >= pairTtlMs) {
        pairs.delete(code);
        for (const side of [pair.a, pair.b]) {
          if (!side) continue;
          try {
            side.close(1001, "pair expired");
          } catch {
            // ignore
          }
        }
      }
    }
  }, sweepIntervalMs);
  if (typeof sweeper.unref === "function") sweeper.unref();

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      httpServer.off("listening", onListening);
      reject(err);
    };
    const onListening = (): void => {
      httpServer.off("error", onError);
      resolve();
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(parsed.port, host);
  });

  const address = httpServer.address();
  const boundPort = typeof address === "object" && address ? address.port : parsed.port;

  async function stop(): Promise<void> {
    clearInterval(sweeper);
    for (const pair of pairs.values()) {
      for (const side of [pair.a, pair.b]) {
        if (!side) continue;
        try {
          side.close(1001, "relay stopping");
        } catch {
          // ignore
        }
      }
    }
    pairs.clear();
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  }

  return { port: boundPort, host, stop };
}

const HTTP_STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  409: "Conflict",
};

function rejectUpgrade(
  socket: import("node:stream").Duplex,
  status: number,
  reason: string,
): void {
  const statusText = HTTP_STATUS_TEXT[status] ?? "Error";
  const body = `${reason}\n`;
  const response =
    `HTTP/1.1 ${status} ${statusText}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    `Connection: close\r\n\r\n${body}`;
  try {
    socket.write(response);
  } finally {
    socket.destroy();
  }
}
