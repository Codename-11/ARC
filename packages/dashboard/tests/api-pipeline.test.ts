// ---------------------------------------------------------------------------
// Phase 8 — /api/pipeline/* endpoints (integration)
// ---------------------------------------------------------------------------
//
// Mocks `StagedWorkflowManager` + `InMemoryMessageBus` so we can script
// phase transitions via the `onPhaseChange` callback, verify WS broadcast +
// persistence, and round-trip history GETs.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";

const hoisted = vi.hoisted(() => {
  class MockMessageBus {
    // no-op; the manager won't actually read from it in the mock
  }

  let capturedOnPhaseChange:
    | ((phase: string) => void)
    | undefined;

  const setOnPhaseChange = (fn: (phase: string) => void): void => {
    capturedOnPhaseChange = fn;
  };

  class MockStagedWorkflowManager {
    constructor(
      private config: { onPhaseChange?: (phase: string) => void },
      _deps: unknown,
    ) {
      if (config.onPhaseChange) setOnPhaseChange(config.onPhaseChange);
    }

    async run(): Promise<Record<string, unknown>> {
      const cb = capturedOnPhaseChange ?? this.config.onPhaseChange;
      if (cb) {
        cb("plan");
        await new Promise((r) => setTimeout(r, 1));
        cb("exec");
        await new Promise((r) => setTimeout(r, 1));
        cb("verify");
        await new Promise((r) => setTimeout(r, 1));
        cb("complete");
      }
      return {
        phase: "complete",
        transcript: [],
        durationMs: 42,
        phasesCompleted: ["plan", "exec", "verify"],
        phasesTimedOut: [],
      };
    }
  }

  return { MockMessageBus, MockStagedWorkflowManager };
});

vi.mock("@axiom-labs/arc-core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    writeLogEvent: vi.fn(),
    logEvent: vi.fn(),
    logAction: vi.fn(),
    queryLogEvents: vi.fn(() => []),
    InMemoryMessageBus: hoisted.MockMessageBus,
    StagedWorkflowManager: hoisted.MockStagedWorkflowManager,
  };
});

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

describe("/api/pipeline/* endpoints", () => {
  let server: DashboardServer;
  let port: number;
  let baseUrl: string;
  let arcDir: string;

  beforeAll(async () => {
    arcDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-pipe-api-test-"));
    fs.mkdirSync(path.join(arcDir, "pipelines"), { recursive: true });
    process.env["ARC_DIR"] = arcDir;

    port = 45000 + Math.floor(Math.random() * 5000);
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

  it("POST /api/pipeline/run rejects missing agents", async () => {
    const res = await fetch(`${baseUrl}/api/pipeline/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({ phases: ["plan"] }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/pipeline/run broadcasts phase transitions + persists", async () => {
    const wsSocket = await connectWebSocket(port);
    await new Promise((r) => setTimeout(r, 30));

    const framesPromise = collectFrames(
      wsSocket,
      (m) =>
        m.event === "pipeline-event" &&
        typeof m.data === "object" &&
        m.data !== null &&
        (m.data as { phase?: string }).phase === "persisted",
      5000,
    );

    const res = await fetch(`${baseUrl}/api/pipeline/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({
        phases: ["plan", "exec", "verify"],
        phaseTimeoutMs: { plan: 5000, exec: 5000, verify: 5000 },
        agents: [{ profileName: "alpha" }, { profileName: "beta" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pipelineId: string };
    expect(body.pipelineId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const frames = await framesPromise;
    const phases = frames
      .filter((f) => f.event === "pipeline-event")
      .map((f) => (f.data as { phase: string }).phase);
    expect(phases).toContain("plan");
    expect(phases).toContain("exec");
    expect(phases).toContain("verify");
    expect(phases).toContain("complete");
    expect(phases).toContain("persisted");

    const filePath = path.join(arcDir, "pipelines", `${body.pipelineId}.json`);
    expect(fs.existsSync(filePath)).toBe(true);
    const stored = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      id: string;
      phases: string[];
      result: { phasesCompleted: string[] };
    };
    expect(stored.id).toBe(body.pipelineId);
    expect(stored.phases).toEqual(["plan", "exec", "verify"]);
    expect(stored.result.phasesCompleted).toEqual(["plan", "exec", "verify"]);

    wsSocket.destroy();
    await new Promise((r) => setTimeout(r, 30));
  });

  it("GET /api/pipeline/history returns persisted entries", async () => {
    const res = await fetch(`${baseUrl}/api/pipeline/history`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; phases: string[] }>;
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].phases).toEqual(["plan", "exec", "verify"]);
  });

  it("GET /api/pipeline/:id round-trips full result", async () => {
    const history = (await (
      await fetch(`${baseUrl}/api/pipeline/history`)
    ).json()) as Array<{ id: string }>;
    const id = history[0].id;
    const res = await fetch(`${baseUrl}/api/pipeline/${encodeURIComponent(id)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      result: { durationMs: number };
    };
    expect(body.id).toBe(id);
    expect(body.result.durationMs).toBe(42);
  });

  it("GET /api/pipeline/:id rejects non-UUID ids", async () => {
    const res = await fetch(`${baseUrl}/api/pipeline/not-a-uuid`);
    expect(res.status).toBe(400);
  });
});
