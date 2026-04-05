import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Mock logging so stores don't hit the filesystem log path unexpectedly.
// ---------------------------------------------------------------------------

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

import { createDashboardServer } from "../../packages/dashboard/src/server.js";
import type { DashboardServer } from "../../packages/dashboard/src/server.js";
import { WebSocketServer, WebSocketClient } from "../../packages/dashboard/src/ws.js";
import { SessionStore, TaskStore } from "@axiom-labs/arc-core";

// ---------------------------------------------------------------------------
// Helpers — raw TCP WebSocket client (no ws dependency)
// ---------------------------------------------------------------------------

/** Minimal WS frame encoder (client-to-server = masked). */
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
    header[0] = 0x81; // FIN + text opcode
    header[1] = 0x80 | payload.length; // mask bit set
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  }

  return Buffer.concat([header, maskKey, masked]);
}

/** Perform the WebSocket upgrade handshake and return the raw socket. */
function connectWebSocket(
  port: number,
  host = "localhost",
): Promise<import("node:net").Socket> {
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

    req.on("upgrade", (_res, socket, _head) => {
      resolve(socket);
    });

    req.on("error", reject);
    req.end();
  });
}

/** Read the next text frame from a raw WS socket. Returns the decoded string. */
function readNextFrame(
  socket: import("node:net").Socket,
  timeoutMs = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeAllListeners("data");
      reject(new Error("Timed out waiting for WebSocket frame"));
    }, timeoutMs);

    socket.once("data", (buf: Buffer) => {
      clearTimeout(timer);

      if (buf.length < 2) {
        reject(new Error("Frame too short"));
        return;
      }

      const opcode = buf[0] & 0x0f;
      if (opcode !== 0x01) {
        // Not a text frame — could be ping, just read the next one.
        readNextFrame(socket, timeoutMs).then(resolve, reject);
        return;
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

      // Server-to-client frames are unmasked.
      const payload = buf.subarray(offset, offset + payloadLength);
      resolve(payload.toString("utf-8"));
    });
  });
}

// ===========================================================================
// Unit tests for WebSocketServer (no HTTP server needed)
// ===========================================================================

describe("WebSocketServer — unit", () => {
  it("getClients() returns empty set initially", () => {
    const wss = new WebSocketServer();
    expect(wss.getClients().size).toBe(0);
    expect(wss.size).toBe(0);
  });

  it("broadcast() does not throw with no clients", () => {
    const wss = new WebSocketServer();
    expect(() => wss.broadcast("test", { foo: 1 })).not.toThrow();
  });

  it("close() is idempotent when no clients are connected", () => {
    const wss = new WebSocketServer();
    expect(() => wss.close()).not.toThrow();
    expect(() => wss.close()).not.toThrow();
  });

  it("startHeartbeat() and close() manage the timer without error", () => {
    const wss = new WebSocketServer();
    wss.startHeartbeat(100);
    // Should be able to close cleanly — timer is cleared.
    wss.close();
    expect(wss.size).toBe(0);
  });

  it("onConnection handler is stored", () => {
    const wss = new WebSocketServer();
    const handler = vi.fn();
    wss.onConnection(handler);
    // Handler is only called during handleUpgrade — just verify no error.
    expect(wss.size).toBe(0);
  });
});

// ===========================================================================
// Integration: WebSocket via dashboard HTTP server
// ===========================================================================

describe("Dashboard WebSocket — integration", () => {
  let server: DashboardServer;
  let port: number;
  let arcDir: string;

  beforeAll(async () => {
    arcDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-dashboard-ws-test-"));
    fs.mkdirSync(path.join(arcDir, "profiles"), { recursive: true });
    fs.mkdirSync(path.join(arcDir, "tasks"), { recursive: true });
    fs.mkdirSync(path.join(arcDir, "logs"), { recursive: true });
    process.env["ARC_DIR"] = arcDir;

    port = 31000 + Math.floor(Math.random() * 10000);
    server = createDashboardServer(
      { port, host: "localhost" },
      { sessions: new SessionStore(), tasks: new TaskStore() },
    );
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    try {
      fs.rmSync(arcDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
    delete process.env["ARC_DIR"];
  });

  it("accepts a WebSocket upgrade and tracks the client", async () => {
    const socket = await connectWebSocket(port);

    // Give the server a moment to register the client.
    await new Promise((r) => setTimeout(r, 50));

    expect(server.ws.size).toBeGreaterThanOrEqual(1);

    socket.destroy();

    // Wait for cleanup.
    await new Promise((r) => setTimeout(r, 50));
  });

  it("broadcast() delivers a message to a connected client", async () => {
    const socket = await connectWebSocket(port);
    await new Promise((r) => setTimeout(r, 50));

    // Start listening for the next frame before broadcasting.
    const framePromise = readNextFrame(socket, 3000);
    server.ws.broadcast("test-event", { count: 42 });

    const raw = await framePromise;
    const parsed = JSON.parse(raw) as {
      event: string;
      data: { count: number };
      timestamp: string;
    };

    expect(parsed.event).toBe("test-event");
    expect(parsed.data.count).toBe(42);
    expect(parsed).toHaveProperty("timestamp");

    socket.destroy();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("multiple clients each receive broadcast", async () => {
    const socket1 = await connectWebSocket(port);
    const socket2 = await connectWebSocket(port);
    await new Promise((r) => setTimeout(r, 50));

    const frame1Promise = readNextFrame(socket1, 3000);
    const frame2Promise = readNextFrame(socket2, 3000);

    server.ws.broadcast("multi", { msg: "hello" });

    const [raw1, raw2] = await Promise.all([frame1Promise, frame2Promise]);

    expect(JSON.parse(raw1).event).toBe("multi");
    expect(JSON.parse(raw2).event).toBe("multi");

    socket1.destroy();
    socket2.destroy();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("client disconnect reduces client count", async () => {
    // Close all lingering sockets from earlier tests first.
    for (const c of server.ws.getClients()) {
      c.close();
    }
    await new Promise((r) => setTimeout(r, 150));

    const socket = await connectWebSocket(port);
    await new Promise((r) => setTimeout(r, 100));

    const countBefore = server.ws.size;
    expect(countBefore).toBeGreaterThanOrEqual(1);

    // Send a proper WebSocket close frame (opcode 0x08) so the server
    // recognises the closure and removes the client from its set.
    const closeFrame = Buffer.alloc(6);
    closeFrame[0] = 0x88; // FIN + close opcode
    closeFrame[1] = 0x80; // mask bit set, 0-length payload
    // 4 bytes of mask key (all zeros is fine for empty payload).
    socket.write(closeFrame);

    // Wait for the server to process the close frame and clean up.
    await new Promise((r) => setTimeout(r, 200));

    expect(server.ws.size).toBeLessThan(countBefore);

    socket.destroy();
    await new Promise((r) => setTimeout(r, 50));
  });
});

// ===========================================================================
// Polling mechanism
// ===========================================================================

describe("Dashboard polling", () => {
  let server: DashboardServer;
  let port: number;
  let arcDir: string;
  let sessions: SessionStore;
  let tasks: TaskStore;

  beforeAll(async () => {
    arcDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-dashboard-poll-test-"));
    fs.mkdirSync(path.join(arcDir, "profiles"), { recursive: true });
    fs.mkdirSync(path.join(arcDir, "tasks"), { recursive: true });
    fs.mkdirSync(path.join(arcDir, "logs"), { recursive: true });
    process.env["ARC_DIR"] = arcDir;

    sessions = new SessionStore();
    tasks = new TaskStore();

    port = 32000 + Math.floor(Math.random() * 10000);
    server = createDashboardServer(
      { port, host: "localhost" },
      { sessions, tasks },
    );
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    try {
      fs.rmSync(arcDir, { recursive: true, force: true });
    } catch {
      // Best-effort.
    }
    delete process.env["ARC_DIR"];
  });

  it("startPolling() returns a cleanup function", () => {
    const stopPolling = server.startPolling(500);
    expect(typeof stopPolling).toBe("function");
    stopPolling();
  });

  it("stopPolling() stops the interval cleanly", () => {
    const stopPolling = server.startPolling(100);
    // Should not throw when called multiple times.
    stopPolling();
    stopPolling();
  });

  it("polling detects new sessions and broadcasts an update", async () => {
    const socket = await connectWebSocket(port);
    await new Promise((r) => setTimeout(r, 50));

    // Start polling at a fast interval.
    const stopPolling = server.startPolling(100);

    // Listen for the broadcast frame.
    const framePromise = readNextFrame(socket, 5000);

    // Mutate: add a session to trigger a count change.
    sessions.create("poll-test-session", "default", "claude");

    const raw = await framePromise;
    const parsed = JSON.parse(raw) as {
      event: string;
      data: { sessions: number; tasks: number };
    };

    expect(parsed.event).toBe("update");
    expect(parsed.data.sessions).toBeGreaterThanOrEqual(1);

    stopPolling();
    socket.destroy();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("polling detects new tasks and broadcasts an update", async () => {
    const socket = await connectWebSocket(port);
    await new Promise((r) => setTimeout(r, 50));

    // Start polling. The first tick will detect the diff from 0 → current
    // counts (from earlier tests). We consume that initial broadcast, then
    // mutate so the *next* broadcast reflects the new task.
    const stopPolling = server.startPolling(100);

    // Consume the initial baseline-diff broadcast (if any).
    try {
      await readNextFrame(socket, 300);
    } catch {
      // No initial broadcast if counts happened to be 0 — that's fine.
    }

    // Now the poller's lastCounts matches the current state.
    // Wait for one more tick so the baseline is definitely stable.
    await new Promise((r) => setTimeout(r, 150));

    const taskCountBefore = tasks.list().length;
    tasks.create("poll-test-task", { priority: "medium" });

    const framePromise = readNextFrame(socket, 5000);
    const raw = await framePromise;
    const parsed = JSON.parse(raw) as {
      event: string;
      data: { sessions: number; tasks: number };
    };

    expect(parsed.event).toBe("update");
    expect(parsed.data.tasks).toBe(taskCountBefore + 1);

    stopPolling();
    socket.destroy();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("polling does not broadcast when counts are unchanged", async () => {
    const stopPolling = server.startPolling(100);

    // Wait for the initial baseline-diff broadcast (first tick detects
    // the diff from 0 → current counts). After that, counts are stable.
    await new Promise((r) => setTimeout(r, 200));

    // Now spy — from this point on, no mutations happen, so no further
    // broadcasts should occur.
    const broadcastSpy = vi.spyOn(server.ws, "broadcast");

    // Wait several more intervals with no store changes.
    await new Promise((r) => setTimeout(r, 400));

    expect(broadcastSpy).not.toHaveBeenCalled();

    stopPolling();
    broadcastSpy.mockRestore();
  });
});
