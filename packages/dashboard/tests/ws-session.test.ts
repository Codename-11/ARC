// ---------------------------------------------------------------------------
// Phase 7 — per-session WS routing tests
// ---------------------------------------------------------------------------
//
// Exercises the `hello` handshake + `broadcastTo` routing while confirming
// that the legacy `broadcast` fan-out is preserved for clients that never
// opt in to a sessionId.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";

vi.mock("@axiom-labs/arc-core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    writeLogEvent: vi.fn(),
    logEvent: vi.fn(),
    logAction: vi.fn(),
    queryLogEvents: vi.fn(() => []),
  };
});

import { createDashboardServer } from "../src/server.js";
import type { DashboardServer } from "../src/server.js";
import { WebSocketServer, WebSocketClient } from "../src/ws.js";

// ---------------------------------------------------------------------------
// Minimal WS test helpers — mirrors the pattern used by
// tests/integration/dashboard-ws.test.ts so we don't take a `ws` dependency.
// ---------------------------------------------------------------------------

function encodeClientFrame(data: string): Buffer {
  const payload = Buffer.from(data, "utf-8");
  const maskKey = crypto.randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i] ^ maskKey[i % 4];
  }

  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = 0x80 | payload.length;
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  }
  return Buffer.concat([header, maskKey, masked]);
}

function connectWebSocket(port: number, host = "localhost"): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    const req = http.request({
      host,
      port,
      path: "/",
      method: "GET",
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": key,
        "Sec-WebSocket-Version": "13",
      },
    });
    req.on("upgrade", (_res, socket) => resolve(socket as net.Socket));
    req.on("error", reject);
    req.end();
  });
}

function readNextFrame(socket: net.Socket, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeAllListeners("data");
      reject(new Error("Timed out waiting for WebSocket frame"));
    }, timeoutMs);

    socket.once("data", (buf: Buffer) => {
      clearTimeout(timer);
      if (buf.length < 2) return reject(new Error("Frame too short"));
      const opcode = buf[0] & 0x0f;
      if (opcode !== 0x01) {
        return readNextFrame(socket, timeoutMs).then(resolve, reject);
      }
      let payloadLength = buf[1] & 0x7f;
      let offset = 2;
      if (payloadLength === 126) {
        payloadLength = buf.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        payloadLength = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }
      resolve(buf.subarray(offset, offset + payloadLength).toString("utf-8"));
    });
  });
}

// ---------------------------------------------------------------------------
// Unit: WebSocketServer session registry
// ---------------------------------------------------------------------------

describe("WebSocketServer — session registry (unit)", () => {
  it("broadcastTo with no such session is a silent no-op", () => {
    const wss = new WebSocketServer();
    expect(() => wss.broadcastTo("nope", "x", { a: 1 })).not.toThrow();
    expect(wss.getSessionClient("nope")).toBeNull();
  });

  it("getSessionClient returns null for an unknown id", () => {
    const wss = new WebSocketServer();
    expect(wss.getSessionClient("missing")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: hello handshake + per-session routing + broadcast preservation
// ---------------------------------------------------------------------------

describe("Dashboard WS — session routing (integration)", () => {
  let server: DashboardServer;
  let port: number;
  let arcDir: string;

  beforeAll(async () => {
    arcDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-ws-session-test-"));
    fs.mkdirSync(path.join(arcDir, "profiles"), { recursive: true });
    fs.mkdirSync(path.join(arcDir, "logs"), { recursive: true });
    process.env["ARC_DIR"] = arcDir;

    port = 34000 + Math.floor(Math.random() * 5000);
    server = createDashboardServer({ port, host: "localhost" }, {});
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    try {
      fs.rmSync(arcDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    delete process.env["ARC_DIR"];
  });

  it("hello message registers a sessionId and broadcastTo reaches only that client", async () => {
    const socketA = await connectWebSocket(port);
    const socketB = await connectWebSocket(port);
    await new Promise((r) => setTimeout(r, 60));

    // Register only socketA under a session id.
    socketA.write(encodeClientFrame(JSON.stringify({ type: "hello", sessionId: "sess-A" })));
    await new Promise((r) => setTimeout(r, 60));

    const clientA = server.ws.getSessionClient("sess-A");
    expect(clientA).not.toBeNull();
    expect((clientA as WebSocketClient).sessionId).toBe("sess-A");

    // broadcastTo("sess-A") should only reach socketA.
    const promiseA = readNextFrame(socketA, 2000);
    server.ws.broadcastTo("sess-A", "chat-chunk", { content: "hello A" });

    const raw = await promiseA;
    const parsed = JSON.parse(raw);
    expect(parsed.event).toBe("chat-chunk");
    expect(parsed.data.content).toBe("hello A");

    // socketB should NOT have received anything — verify with a short timeout.
    let bReceived = false;
    const bListener = () => {
      bReceived = true;
    };
    socketB.once("data", bListener);
    await new Promise((r) => setTimeout(r, 200));
    expect(bReceived).toBe(false);
    socketB.removeListener("data", bListener);

    socketA.destroy();
    socketB.destroy();
    await new Promise((r) => setTimeout(r, 60));
  });

  it("broadcast() still reaches all clients, including ones without hello", async () => {
    const socketA = await connectWebSocket(port);
    const socketB = await connectWebSocket(port);
    await new Promise((r) => setTimeout(r, 60));

    // socketA opts in to a sessionId; socketB remains legacy.
    socketA.write(encodeClientFrame(JSON.stringify({ type: "hello", sessionId: "sess-X" })));
    await new Promise((r) => setTimeout(r, 60));

    const pA = readNextFrame(socketA, 2000);
    const pB = readNextFrame(socketB, 2000);
    server.ws.broadcast("ping", { from: "test" });

    const [rawA, rawB] = await Promise.all([pA, pB]);
    expect(JSON.parse(rawA).event).toBe("ping");
    expect(JSON.parse(rawB).event).toBe("ping");

    socketA.destroy();
    socketB.destroy();
    await new Promise((r) => setTimeout(r, 60));
  });

  it("broadcastTo silently drops when sessionId is unregistered", async () => {
    // No clients under "ghost" — call should not throw.
    expect(() =>
      server.ws.broadcastTo("ghost-session-id", "chat-chunk", { content: "x" }),
    ).not.toThrow();
  });

  it("client disconnect unregisters its session", async () => {
    const socket = await connectWebSocket(port);
    await new Promise((r) => setTimeout(r, 60));
    socket.write(encodeClientFrame(JSON.stringify({ type: "hello", sessionId: "sess-drop" })));
    await new Promise((r) => setTimeout(r, 60));
    expect(server.ws.getSessionClient("sess-drop")).not.toBeNull();

    // Send a proper close frame so the server cleans up.
    const closeFrame = Buffer.alloc(6);
    closeFrame[0] = 0x88;
    closeFrame[1] = 0x80;
    socket.write(closeFrame);
    await new Promise((r) => setTimeout(r, 200));

    expect(server.ws.getSessionClient("sess-drop")).toBeNull();

    socket.destroy();
  });

  it("invalid hello payload leaves sessionId unregistered", async () => {
    const socket = await connectWebSocket(port);
    await new Promise((r) => setTimeout(r, 60));

    // Malformed JSON.
    socket.write(encodeClientFrame("not-json"));
    // Well-formed JSON but missing required fields.
    socket.write(encodeClientFrame(JSON.stringify({ type: "hi" })));
    await new Promise((r) => setTimeout(r, 80));

    expect(server.ws.getSessionClient("hi")).toBeNull();

    socket.destroy();
    await new Promise((r) => setTimeout(r, 60));
  });
});
