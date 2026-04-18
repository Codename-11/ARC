// ---------------------------------------------------------------------------
// Phase 8 — /api/roundtable/* endpoints (integration)
// ---------------------------------------------------------------------------
//
// Mocks `RoundtableOrchestrator` from `@axiom-labs/arc-core` so we can drive
// scripted events through `onEvent`, verify they reach the WebSocket via
// `broadcast`, and assert the final record is persisted to disk.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
  const scripted: Array<{
    events: Array<Record<string, unknown>>;
    result: Record<string, unknown>;
  }> = [];

  class MockRoundtableOrchestrator {
    async run(opts: {
      topic: string;
      agents: Array<Record<string, unknown>>;
      onEvent?: (evt: Record<string, unknown>) => void;
    }): Promise<Record<string, unknown>> {
      const script = scripted.shift() ?? {
        events: [
          {
            type: "turn-complete",
            agent: "agent-0",
            role: "advocate",
            round: 1,
            latencyMs: 5,
            content: "default turn",
          },
          { type: "synthesis-complete", consensusScore: 0.7, summary: "ok" },
        ],
        result: {
          transcript: [],
          synthesis: "ok",
          consensusScore: 0.7,
          keyPoints: [],
          durationMs: 1,
          roundtableId: "mock-rt-id",
        },
      };
      for (const e of script.events) {
        opts.onEvent?.(e);
        await new Promise((r) => setTimeout(r, 1));
      }
      return script.result;
    }
  }

  return { scripted, MockRoundtableOrchestrator };
});

vi.mock("@axiom-labs/arc-core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    writeLogEvent: vi.fn(),
    logEvent: vi.fn(),
    logAction: vi.fn(),
    queryLogEvents: vi.fn(() => []),
    RoundtableOrchestrator: hoisted.MockRoundtableOrchestrator,
    loadConfig: vi.fn(() => ({
      version: 1,
      activeProfile: "alpha",
      profiles: {
        alpha: {
          authType: "api-key",
          tool: "claude",
          configDir: "/tmp/alpha",
          createdAt: "2026-01-01T00:00:00Z",
        },
        beta: {
          authType: "api-key",
          tool: "claude",
          configDir: "/tmp/beta",
          createdAt: "2026-01-01T00:00:00Z",
        },
      },
    })),
  };
});

function pushScript(events: Array<Record<string, unknown>>, result: Record<string, unknown>): void {
  hoisted.scripted.push({ events, result });
}

// ---------------------------------------------------------------------------
// Server + WS helpers
// ---------------------------------------------------------------------------

import { createDashboardServer } from "../src/server.js";
import type { DashboardServer } from "../src/server.js";

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

function collectFrames(
  socket: net.Socket,
  stopPredicate: (msg: { event: string; data: unknown }) => boolean,
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
          const raw = buf
            .subarray(offset + headerLen, offset + headerLen + payloadLength)
            .toString("utf-8");
          try {
            const parsed = JSON.parse(raw) as { event: string; data: unknown };
            out.push(parsed);
            if (stopPredicate(parsed)) {
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

describe("/api/roundtable/* endpoints", () => {
  let server: DashboardServer;
  let port: number;
  let baseUrl: string;
  let arcDir: string;

  beforeAll(async () => {
    arcDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-rt-api-test-"));
    fs.mkdirSync(path.join(arcDir, "roundtables"), { recursive: true });
    process.env["ARC_DIR"] = arcDir;

    port = 40000 + Math.floor(Math.random() * 5000);
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

  it("POST /api/roundtable/run rejects missing fields", async () => {
    const res = await fetch(`${baseUrl}/api/roundtable/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({ topic: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/roundtable/run streams events + persists record", async () => {
    pushScript(
      [
        {
          type: "turn-complete",
          agent: "alpha",
          role: "advocate",
          round: 1,
          latencyMs: 10,
          content: "go",
        },
        {
          type: "turn-complete",
          agent: "beta",
          role: "critic",
          round: 1,
          latencyMs: 12,
          content: "wait",
        },
        { type: "synthesis-complete", consensusScore: 0.82, summary: "mixed" },
      ],
      {
        transcript: [
          { agent: "alpha", role: "advocate", round: 1, content: "go", latencyMs: 10, createdAt: 1 },
          { agent: "beta", role: "critic", round: 1, content: "wait", latencyMs: 12, createdAt: 2 },
        ],
        synthesis: "mixed",
        consensusScore: 0.82,
        keyPoints: ["gather more data"],
        durationMs: 50,
        roundtableId: "inner-id",
      },
    );

    const wsSocket = await connectWebSocket(port);
    await new Promise((r) => setTimeout(r, 30));
    const framesPromise = collectFrames(
      wsSocket,
      (m) =>
        m.event === "roundtable-event" &&
        typeof m.data === "object" &&
        m.data !== null &&
        (m.data as { event?: { type?: string } }).event?.type === "persisted",
      5000,
    );

    const res = await fetch(`${baseUrl}/api/roundtable/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({
        topic: "should we ship",
        agents: [
          { profileName: "alpha", role: "advocate" },
          { profileName: "beta", role: "critic" },
        ],
        rounds: 1,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roundtableId: string };
    expect(typeof body.roundtableId).toBe("string");
    expect(body.roundtableId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const frames = await framesPromise;
    const turnFrames = frames.filter(
      (f) =>
        f.event === "roundtable-event" &&
        (f.data as { event: { type: string } }).event.type === "turn-complete",
    );
    const synthFrames = frames.filter(
      (f) =>
        f.event === "roundtable-event" &&
        (f.data as { event: { type: string } }).event.type === "synthesis-complete",
    );
    expect(turnFrames.length).toBe(2);
    expect(synthFrames.length).toBe(1);

    const filePath = path.join(arcDir, "roundtables", `${body.roundtableId}.json`);
    expect(fs.existsSync(filePath)).toBe(true);
    const stored = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      id: string;
      topic: string;
      result: { consensusScore: number };
    };
    expect(stored.id).toBe(body.roundtableId);
    expect(stored.topic).toBe("should we ship");
    expect(stored.result.consensusScore).toBe(0.82);

    wsSocket.destroy();
    await new Promise((r) => setTimeout(r, 30));
  });

  it("GET /api/roundtable/history returns sorted summaries", async () => {
    const res = await fetch(`${baseUrl}/api/roundtable/history`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      id: string;
      topic: string;
      consensusScore?: number;
    }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].topic).toBe("should we ship");
    expect(body[0].consensusScore).toBe(0.82);
  });

  it("GET /api/roundtable/:id round-trips full result", async () => {
    const history = (await (await fetch(`${baseUrl}/api/roundtable/history`)).json()) as Array<{
      id: string;
    }>;
    const id = history[0].id;
    const res = await fetch(`${baseUrl}/api/roundtable/${encodeURIComponent(id)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      result: { transcript: unknown[]; keyPoints: string[] };
    };
    expect(body.id).toBe(id);
    expect(Array.isArray(body.result.transcript)).toBe(true);
    expect(body.result.keyPoints).toEqual(["gather more data"]);
  });

  it("GET /api/roundtable/:id rejects path traversal / non-UUID ids", async () => {
    const res = await fetch(`${baseUrl}/api/roundtable/..%2Fevil`);
    expect(res.status).toBe(400);
  });

  it("POST /api/roundtable/run rejects unknown profile", async () => {
    const res = await fetch(`${baseUrl}/api/roundtable/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({
        topic: "missing profile",
        agents: [
          { profileName: "alpha", role: "advocate" },
          { profileName: "ghost", role: "critic" },
        ],
      }),
    });
    expect(res.status).toBe(404);
  });
});
