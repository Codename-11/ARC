// ---------------------------------------------------------------------------
// Phase 7 — /api/chat/* endpoints (integration)
// ---------------------------------------------------------------------------
//
// The chat endpoints talk to `@axiom-labs/arc-core` for session persistence,
// tool-registry, knowledge prompt composition, and agent dispatch. We mock
// those modules so tests can stream a deterministic agent run through the
// WebSocket and verify the routing + persistence shape without booting a
// real LLM provider.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Mock the chat/agent/knowledge surface of @axiom-labs/arc-core
// ---------------------------------------------------------------------------
//
// vi.mock factories are hoisted, so all state they reference must be declared
// via vi.hoisted(). The MockChatSession class + scripted-event queue live in
// that hoisted bag so both the mock and the test body share the same refs.

const hoisted = vi.hoisted(() => {
  interface MockMessage {
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    toolCalls?: unknown[];
    toolCallId?: string;
    timestamp: string;
  }

  class MockChatSession {
    id: string;
    profileName: string;
    permissionMode: string;
    messages: MockMessage[] = [];
    createdAt = new Date().toISOString();
    updatedAt = this.createdAt;

    constructor(init: { profileName: string; permissionMode: string; id?: string }) {
      this.id = init.id ?? `sess-${Math.random().toString(16).slice(2)}`;
      this.profileName = init.profileName;
      this.permissionMode = init.permissionMode;
    }

    append(msg: Omit<MockMessage, "timestamp"> & { timestamp?: string }): MockMessage {
      const stored: MockMessage = { ...msg, timestamp: msg.timestamp ?? new Date().toISOString() };
      this.messages.push(stored);
      this.updatedAt = stored.timestamp;
      return stored;
    }

    summary(): string {
      return this.messages.find((m) => m.role === "user")?.content.slice(0, 40) ?? "(empty)";
    }

    serialize(): unknown {
      return {
        id: this.id,
        profileName: this.profileName,
        permissionMode: this.permissionMode,
        messages: this.messages,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
      };
    }

    static load(json: unknown): MockChatSession {
      const obj = json as {
        id: string;
        profileName: string;
        permissionMode: string;
        messages?: MockMessage[];
        createdAt?: string;
        updatedAt?: string;
      };
      const s = new MockChatSession({
        id: obj.id,
        profileName: obj.profileName,
        permissionMode: obj.permissionMode,
      });
      s.messages = obj.messages ?? [];
      s.createdAt = obj.createdAt ?? s.createdAt;
      s.updatedAt = obj.updatedAt ?? s.updatedAt;
      return s;
    }
  }

  const chatStore = new Map<string, MockChatSession>();
  const scriptedEvents: Array<Array<Record<string, unknown>>> = [];

  return { MockChatSession, chatStore, scriptedEvents };
});

vi.mock("@axiom-labs/arc-core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const { MockChatSession, chatStore, scriptedEvents } = hoisted;
  return {
    ...actual,
    writeLogEvent: vi.fn(),
    logEvent: vi.fn(),
    logAction: vi.fn(),
    queryLogEvents: vi.fn(() => []),
    ChatSession: MockChatSession,
    saveSession: vi.fn((s: InstanceType<typeof MockChatSession>) => {
      chatStore.set(`${s.profileName}/${s.id}`, s);
    }),
    loadSession: vi.fn((profile: string, id: string) => {
      const s = chatStore.get(`${profile}/${id}`);
      if (!s) throw new Error(`not found: ${profile}/${id}`);
      return s;
    }),
    listSessions: vi.fn((profile: string) =>
      [...chatStore.values()]
        .filter((s) => s.profileName === profile)
        .map((s) => ({
          id: s.id,
          summary: s.summary(),
          profileName: s.profileName,
          updatedAt: s.updatedAt,
          createdAt: s.createdAt,
          messageCount: s.messages.length,
        })),
    ),
    deleteSession: vi.fn((profile: string, id: string) => {
      chatStore.delete(`${profile}/${id}`);
    }),
    ToolRegistry: class {
      async execute(): Promise<unknown> {
        return { ok: true, output: "ok" };
      }
      has(): boolean {
        return false;
      }
    },
    registerArcTools: vi.fn(),
    runAgent: async function* (): AsyncIterable<Record<string, unknown>> {
      const script = scriptedEvents.shift() ?? [
        { type: "text", content: "hello from mock" },
        { type: "done", reason: "end_turn" },
      ];
      for (const ev of script) {
        yield ev;
        await new Promise((r) => setTimeout(r, 1));
      }
    },
    getAgentClientForProfile: vi.fn(() => ({})),
    buildSystemPrompt: vi.fn(() => "system prompt"),
  };
});

const { MockChatSession, chatStore, scriptedEvents } = hoisted;
function pushScript(events: Array<Record<string, unknown>>): void {
  scriptedEvents.push(events);
}

// ---------------------------------------------------------------------------
// Server + helpers
// ---------------------------------------------------------------------------

import { createDashboardServer } from "../src/server.js";
import type { DashboardServer } from "../src/server.js";

function encodeClientFrame(data: string): Buffer {
  const payload = Buffer.from(data, "utf-8");
  const maskKey = crypto.randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ maskKey[i % 4];
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

function connectWebSocket(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    const req = http.request({
      host: "localhost",
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

/**
 * Collect frames until either `stopEvent` arrives or `maxDurationMs` elapses.
 * Using an explicit stop event avoids flakiness under CI load where a fixed
 * window may end before the server finishes streaming.
 */
function collectFrames(
  socket: net.Socket,
  stopEvent: string,
  maxDurationMs = 5000,
): Promise<Array<{ event: string; data: unknown }>> {
  return new Promise((resolve) => {
    const out: Array<{ event: string; data: unknown }> = [];
    const finish = () => {
      clearTimeout(timer);
      socket.removeListener("data", onData);
      resolve(out);
    };
    const onData = (buf: Buffer) => {
      let offset = 0;
      while (offset < buf.length) {
        if (buf.length - offset < 2) break;
        const opcode = buf[offset] & 0x0f;
        let payloadLength = buf[offset + 1] & 0x7f;
        let headerLen = 2;
        if (payloadLength === 126) {
          payloadLength = buf.readUInt16BE(offset + 2);
          headerLen = 4;
        } else if (payloadLength === 127) {
          payloadLength = Number(buf.readBigUInt64BE(offset + 2));
          headerLen = 10;
        }
        if (opcode === 0x01) {
          const raw = buf.subarray(offset + headerLen, offset + headerLen + payloadLength).toString("utf-8");
          try {
            const parsed = JSON.parse(raw);
            out.push(parsed);
            if (parsed.event === stopEvent) {
              // Give a small tail so any straggler frames after the stop
              // event can still be captured by the caller's assertions.
              setTimeout(finish, 50);
              return;
            }
          } catch {
            /* ignore */
          }
        }
        offset += headerLen + payloadLength;
      }
    };
    socket.on("data", onData);
    const timer = setTimeout(finish, maxDurationMs);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("/api/chat/* endpoints", () => {
  let server: DashboardServer;
  let port: number;
  let baseUrl: string;
  let arcDir: string;

  beforeAll(async () => {
    arcDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-chat-api-test-"));
    fs.mkdirSync(path.join(arcDir, "profiles"), { recursive: true });
    fs.mkdirSync(path.join(arcDir, "logs"), { recursive: true });
    process.env["ARC_DIR"] = arcDir;

    port = 39000 + Math.floor(Math.random() * 5000);
    server = createDashboardServer({ port, host: "localhost" }, {});
    await server.start();
    baseUrl = `http://localhost:${port}`;
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

  it("GET /api/chat/sessions requires profile query", async () => {
    const res = await fetch(`${baseUrl}/api/chat/sessions`);
    expect(res.status).toBe(400);
  });

  it("GET /api/chat/sessions returns the list for a profile", async () => {
    // Seed one session via the mocked store.
    const seeded = new MockChatSession({ profileName: "default", permissionMode: "supervised" });
    seeded.append({ role: "user", content: "hi there" });
    chatStore.set(`default/${seeded.id}`, seeded);

    const res = await fetch(`${baseUrl}/api/chat/sessions?profile=default`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; summary: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((s) => s.id === seeded.id)).toBe(true);
  });

  it("POST /api/chat/message requires sessionId, profile, message", async () => {
    const res = await fetch(`${baseUrl}/api/chat/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({ profile: "default", message: "hi" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/chat/message streams chunks + done over WS to the registered session", async () => {
    // Script a deterministic agent run.
    pushScript([
      { type: "text", content: "chunk-1 " },
      { type: "text", content: "chunk-2" },
      { type: "done", reason: "end_turn" },
    ]);

    const wsSocket = await connectWebSocket(port);
    await new Promise((r) => setTimeout(r, 50));
    wsSocket.write(encodeClientFrame(JSON.stringify({ type: "hello", sessionId: "ws-1" })));
    await new Promise((r) => setTimeout(r, 50));

    // Start collecting frames BEFORE making the request. Stop as soon as
    // `chat-done` arrives (with a small tail) to keep the test fast while
    // remaining robust under load.
    const framesPromise = collectFrames(wsSocket, "chat-done", 5000);

    const res = await fetch(`${baseUrl}/api/chat/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({
        sessionId: "ws-1",
        profile: "default",
        message: "hello",
        mode: "read-only",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { chatSessionId: string };
    expect(typeof body.chatSessionId).toBe("string");

    const frames = await framesPromise;

    // Expect at least 2 chat-chunk events and one chat-done.
    const chunks = frames.filter((f) => f.event === "chat-chunk");
    const done = frames.filter((f) => f.event === "chat-done");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(done.length).toBeGreaterThanOrEqual(1);

    // The persisted session should now include the user message + assistant turn.
    const stored = chatStore.get(`default/${body.chatSessionId}`);
    expect(stored).toBeDefined();
    expect(stored!.messages.some((m) => m.role === "user")).toBe(true);
    expect(stored!.messages.some((m) => m.role === "assistant")).toBe(true);

    wsSocket.destroy();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("POST /api/chat/confirm rejects unknown tokenIds", async () => {
    const res = await fetch(`${baseUrl}/api/chat/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({ sessionId: "ws-1", tokenId: "does-not-exist", allow: true }),
    });
    expect(res.status).toBe(404);
  });

  it("GET then DELETE /api/chat/sessions/:id round-trips", async () => {
    const seeded = new MockChatSession({ profileName: "default", permissionMode: "supervised" });
    seeded.append({ role: "user", content: "delete me" });
    chatStore.set(`default/${seeded.id}`, seeded);

    const getRes = await fetch(
      `${baseUrl}/api/chat/sessions/${encodeURIComponent(seeded.id)}?profile=default`,
    );
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as { id: string };
    expect(got.id).toBe(seeded.id);

    const delRes = await fetch(
      `${baseUrl}/api/chat/sessions/${encodeURIComponent(seeded.id)}?profile=default`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${server.token}` },
      },
    );
    expect(delRes.status).toBe(200);
    expect(chatStore.has(`default/${seeded.id}`)).toBe(false);
  });
});
