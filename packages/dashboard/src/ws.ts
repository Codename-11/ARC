// ---------------------------------------------------------------------------
// Phase 12 — WebSocket Support (raw node:http upgrade)
// ---------------------------------------------------------------------------
//
// Minimal WebSocket server implementation using only node:http.
// Supports text frames only (opcode 0x1). No binary, no extensions.
// Implements ping/pong for keep-alive.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Magic GUID used during the WebSocket handshake (RFC 6455 section 4.2.2). */
const WS_MAGIC = "258EAFA5-E914-47DA-95CA-5BBB5DC85B11";

/** Opcodes */
const OPCODE_TEXT = 0x01;
const OPCODE_CLOSE = 0x08;
const OPCODE_PING = 0x09;
const OPCODE_PONG = 0x0a;

// ---------------------------------------------------------------------------
// Client wrapper
// ---------------------------------------------------------------------------

export class WebSocketClient {
  public alive = true;
  /**
   * Session id registered by the client via a `hello` message. Used by
   * `WebSocketServer.broadcastTo` for per-session routing. Remains `null`
   * for legacy clients that don't opt in to session negotiation — those
   * clients still receive `broadcast()` messages.
   */
  public sessionId: string | null = null;

  constructor(public readonly socket: Duplex) {
    socket.on("data", (buf: Buffer) => this.handleData(buf));
    socket.on("close", () => {
      this.alive = false;
    });
    socket.on("error", () => {
      this.alive = false;
    });
  }

  // ---- Event callbacks (set by server) ------------------------------------

  /** Called when a complete text message is received. */
  onMessage: ((message: string) => void) | null = null;

  /** Called when the connection closes. */
  onClose: (() => void) | null = null;

  // ---- Public API ---------------------------------------------------------

  /** Send a text frame to this client. */
  send(data: string): void {
    if (!this.alive) return;
    const payload = Buffer.from(data, "utf-8");
    this.socket.write(encodeFrame(OPCODE_TEXT, payload));
  }

  /** Gracefully close the connection. */
  close(): void {
    if (!this.alive) return;
    this.alive = false;
    try {
      this.socket.write(encodeFrame(OPCODE_CLOSE, Buffer.alloc(0)));
      this.socket.end();
    } catch {
      // Socket may already be destroyed.
    }
  }

  // ---- Internal frame parsing ---------------------------------------------

  /**
   * Minimal frame parser. Handles unfragmented text, close, ping, and pong
   * frames. This is intentionally simple — no streaming reassembly.
   */
  private handleData(buf: Buffer): void {
    if (buf.length < 2) return;

    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let payloadLength = buf[1] & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (buf.length < 4) return;
      payloadLength = buf.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      // 64-bit length — we only support up to 32-bit for text messages.
      if (buf.length < 10) return;
      payloadLength = Number(buf.readBigUInt64BE(2));
      offset = 10;
    }

    let maskKey: Buffer | null = null;
    if (masked) {
      if (buf.length < offset + 4) return;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buf.length < offset + payloadLength) return;

    const rawPayload = buf.subarray(offset, offset + payloadLength);
    const payload = Buffer.alloc(rawPayload.length);

    // Unmask if needed (client-to-server frames are always masked per RFC 6455).
    if (maskKey) {
      for (let i = 0; i < rawPayload.length; i++) {
        payload[i] = rawPayload[i] ^ maskKey[i % 4];
      }
    } else {
      rawPayload.copy(payload);
    }

    switch (opcode) {
      case OPCODE_TEXT:
        this.onMessage?.(payload.toString("utf-8"));
        break;

      case OPCODE_PING:
        // Reply with pong carrying the same payload.
        if (this.alive) {
          this.socket.write(encodeFrame(OPCODE_PONG, payload));
        }
        break;

      case OPCODE_PONG:
        // Heartbeat response — mark client alive.
        this.alive = true;
        break;

      case OPCODE_CLOSE:
        this.alive = false;
        this.onClose?.();
        try {
          this.socket.write(encodeFrame(OPCODE_CLOSE, Buffer.alloc(0)));
          this.socket.end();
        } catch {
          // Already closed.
        }
        break;

      default:
        // Unsupported opcode — ignore.
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// WebSocketServer
// ---------------------------------------------------------------------------

export type ConnectionHandler = (client: WebSocketClient) => void;

export class WebSocketServer {
  private clients = new Set<WebSocketClient>();
  /**
   * Registered-session routing table. A client registers itself by sending
   * `{ type: "hello", sessionId }` as its first text frame. Used by
   * `broadcastTo` to target a single logical session.
   */
  private sessions = new Map<string, WebSocketClient>();
  private connectionHandler: ConnectionHandler | null = null;

  // ---- Public API ---------------------------------------------------------

  /** Register a handler called for each new WebSocket connection. */
  onConnection(handler: ConnectionHandler): void {
    this.connectionHandler = handler;
  }

  /** Broadcast a JSON event to all connected clients. */
  broadcast(event: string, data: unknown): void {
    const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    for (const client of this.clients) {
      if (client.alive) {
        client.send(message);
      }
    }
  }

  /**
   * Send a JSON event to the single client registered under `sessionId`.
   * Silently drops the event if no client has registered that session
   * (e.g. the tab was closed before the response arrived).
   *
   * This is the per-session counterpart to `broadcast` — used for
   * chat streaming where only the originating tab should see chunks.
   * See `docs/plans/ai-and-roundtable.md` — AD-5.
   */
  broadcastTo(sessionId: string, event: string, data: unknown): void {
    const client = this.sessions.get(sessionId);
    if (!client || !client.alive) return;
    const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    client.send(message);
  }

  /** Return the client registered under `sessionId`, or null. */
  getSessionClient(sessionId: string): WebSocketClient | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /** Return all currently connected clients. */
  getClients(): ReadonlySet<WebSocketClient> {
    return this.clients;
  }

  /** Number of connected clients. */
  get size(): number {
    return this.clients.size;
  }

  /**
   * Handle an HTTP upgrade request. Attach this to `server.on('upgrade', ...)`.
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }

    // Compute the accept hash per RFC 6455 section 4.2.2.
    const acceptHash = crypto
      .createHash("sha1")
      .update(key + WS_MAGIC)
      .digest("base64");

    const headers = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptHash}`,
      "",
      "",
    ].join("\r\n");

    socket.write(headers);

    // If there was buffered data in `head`, push it back.
    if (head.length > 0) {
      socket.unshift(head);
    }

    const client = new WebSocketClient(socket);
    this.clients.add(client);

    // Allow the connection handler to set its own onMessage first, then
    // wrap it so we can intercept the initial `hello` frame for session
    // registration. Anything that's not a hello falls through to the
    // user's handler (if any).
    this.connectionHandler?.(client);

    const userHandler = client.onMessage;
    client.onMessage = (raw: string): void => {
      if (client.sessionId === null) {
        try {
          const parsed = JSON.parse(raw) as { type?: string; sessionId?: string };
          if (
            parsed &&
            parsed.type === "hello" &&
            typeof parsed.sessionId === "string" &&
            parsed.sessionId.length > 0
          ) {
            // Evict any prior client under the same id (stale tab).
            const prior = this.sessions.get(parsed.sessionId);
            if (prior && prior !== client) {
              prior.sessionId = null;
            }
            client.sessionId = parsed.sessionId;
            this.sessions.set(parsed.sessionId, client);
            return;
          }
        } catch {
          // Not JSON or not a hello — fall through to user handler.
        }
      }
      userHandler?.(raw);
    };

    client.onClose = () => {
      if (client.sessionId && this.sessions.get(client.sessionId) === client) {
        this.sessions.delete(client.sessionId);
      }
      this.clients.delete(client);
    };

    socket.on("close", () => {
      if (client.sessionId && this.sessions.get(client.sessionId) === client) {
        this.sessions.delete(client.sessionId);
      }
      this.clients.delete(client);
    });
  }

  /** Disconnect all clients and stop heartbeat. */
  close(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.sessions.clear();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ---- Heartbeat ----------------------------------------------------------

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Start a periodic ping to detect dead connections.
   * Clients that fail to respond with a pong before the next ping are dropped.
   */
  startHeartbeat(intervalMs = 30_000): void {
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        if (!client.alive) {
          client.close();
          this.clients.delete(client);
          continue;
        }

        // Mark as not-alive; if we receive a pong before next tick it resets.
        client.alive = false;
        try {
          client.socket.write(encodeFrame(OPCODE_PING, Buffer.alloc(0)));
        } catch {
          client.close();
          this.clients.delete(client);
        }
      }
    }, intervalMs);

    // Allow the timer to not hold the process open.
    if (this.heartbeatTimer && typeof this.heartbeatTimer === "object" && "unref" in this.heartbeatTimer) {
      this.heartbeatTimer.unref();
    }
  }
}

// ---------------------------------------------------------------------------
// Frame encoding helper
// ---------------------------------------------------------------------------

/**
 * Encode a WebSocket frame (server-to-client — unmasked).
 */
function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const fin = 0x80;
  const len = payload.length;

  let header: Buffer;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = fin | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = fin | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = fin | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}
