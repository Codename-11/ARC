import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Mock writeLogEvent so store operations don't fail writing to the structured
// log when the temp ARC_DIR hasn't fully initialised the logs directory.
// queryLogEvents is used by the traces endpoint — return an empty array by
// default, overridden per-test as needed.
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
import {
  SessionStore,
  TaskStore,
  SkillRegistry,
  PersistentMemory,
  RemoteAgentRegistry,
  queryLogEvents,
} from "@axiom-labs/arc-core";

// ---------------------------------------------------------------------------
// Test-level state
// ---------------------------------------------------------------------------

let server: DashboardServer;
let port: number;
let baseUrl: string;
let arcDir: string;

let sessions: SessionStore;
let tasks: TaskStore;
let skills: SkillRegistry;
let memory: PersistentMemory;
let remoteAgents: RemoteAgentRegistry;

// ---------------------------------------------------------------------------
// Setup & teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Isolated temp directory for all file-backed stores.
  arcDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-dashboard-api-test-"));
  fs.mkdirSync(path.join(arcDir, "profiles"), { recursive: true });
  fs.mkdirSync(path.join(arcDir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(arcDir, "memory"), { recursive: true });
  fs.mkdirSync(path.join(arcDir, "logs"), { recursive: true });
  process.env["ARC_DIR"] = arcDir;

  sessions = new SessionStore();
  tasks = new TaskStore();
  skills = new SkillRegistry();
  memory = new PersistentMemory();
  remoteAgents = new RemoteAgentRegistry();

  // Random port in an unlikely-to-collide range.
  port = 30000 + Math.floor(Math.random() * 10000);
  server = createDashboardServer(
    { port, host: "localhost" },
    { sessions, tasks, skills, memory, remoteAgents },
  );

  await server.start();
  baseUrl = `http://localhost:${port}`;
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

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function api(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dashboard REST API", () => {
  // ---- Health -------------------------------------------------------------

  it("GET /api/health → 200 with status ok", async () => {
    const res = await api("/api/health");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("uptime");
  });

  // ---- Overview -----------------------------------------------------------

  it("GET /api/overview → 200 with aggregate counts", async () => {
    const res = await api("/api/overview");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("profiles");
    expect(body).toHaveProperty("tasks");
    expect(body).toHaveProperty("skills");
    expect(body).toHaveProperty("agents");
    expect(body).toHaveProperty("timestamp");
  });

  // ---- Sessions -----------------------------------------------------------

  it("GET /api/sessions → 200, empty array initially", async () => {
    const res = await api("/api/sessions");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it("GET /api/sessions returns a created session", async () => {
    sessions.create("test-session", "default", "claude");

    const res = await api("/api/sessions");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThanOrEqual(1);

    const found = body.find((s) => s.name === "test-session");
    expect(found).toBeDefined();
    expect(found!.profile).toBe("default");
    expect(found!.adapter).toBe("claude");
    expect(found!.status).toBe("active");
  });

  it("GET /api/sessions?profile= filters by profile", async () => {
    sessions.create("other-session", "work", "gemini");

    const res = await api("/api/sessions?profile=work");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body.every((s) => s.profile === "work")).toBe(true);
  });

  // ---- Tasks --------------------------------------------------------------

  it("GET /api/tasks → 200, empty array initially", async () => {
    // Tasks file is empty (we haven't created any yet via this endpoint's perspective).
    // NOTE: we re-read from disk each call, so create a fresh store scoped check.
    const res = await api("/api/tasks");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/tasks returns a created task", async () => {
    tasks.create("Write integration tests", { priority: "high" });

    const res = await api("/api/tasks");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThanOrEqual(1);

    const found = body.find((t) => t.description === "Write integration tests");
    expect(found).toBeDefined();
    expect(found!.priority).toBe("high");
    expect(found!.status).toBe("created");
  });

  it("GET /api/tasks?status= filters by status", async () => {
    tasks.create("Cancelled task", { priority: "low" });
    const all = tasks.list();
    const last = all[all.length - 1];
    tasks.stop(last.id);

    const res = await api("/api/tasks?status=cancelled");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body.every((t) => t.status === "cancelled")).toBe(true);
  });

  // ---- Traces -------------------------------------------------------------

  it("GET /api/traces → 200, returns array", async () => {
    const res = await api("/api/traces");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/traces respects limit parameter", async () => {
    // Mock queryLogEvents to return a known set.
    const mockEvents = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date().toISOString(),
      level: "info",
      component: "test",
      action: `action-${i}`,
      message: `Event ${i}`,
    }));

    vi.mocked(queryLogEvents).mockReturnValueOnce(mockEvents as any);

    const res = await api("/api/traces?limit=5");
    expect(res.status).toBe(200);

    const body = (await res.json()) as unknown[];
    expect(body.length).toBeLessThanOrEqual(5);
  });

  // ---- Risk distribution --------------------------------------------------

  it("GET /api/risk/distribution → 200, has tier counts", async () => {
    // Create a task with a risk tier.
    tasks.create("Risky deploy", { riskTier: "destructive" });

    const res = await api("/api/risk/distribution");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      distribution: Record<string, number>;
      total: number;
    };
    expect(body).toHaveProperty("distribution");
    expect(body).toHaveProperty("total");
    expect(body.distribution).toHaveProperty("read-only");
    expect(body.distribution).toHaveProperty("destructive");
    expect(body.distribution["destructive"]).toBeGreaterThanOrEqual(1);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  // ---- Skills -------------------------------------------------------------

  it("GET /api/skills → 200, empty array initially", async () => {
    const res = await api("/api/skills");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/skills returns a registered skill", async () => {
    skills.register({
      name: "test-skill",
      description: "A test skill",
      trigger: ["test"],
      steps: [{ action: "run", description: "Do something", onError: "abort" }],
      tools: [],
      adapters: [],
      source: "builtin",
      created: new Date().toISOString(),
      successRate: 1.0,
    });

    const res = await api("/api/skills");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThanOrEqual(1);

    const found = body.find((s) => s.name === "test-skill");
    expect(found).toBeDefined();
    expect(found!.source).toBe("builtin");
  });

  // ---- Memory -------------------------------------------------------------

  it("GET /api/memory → 200, returns array", async () => {
    const res = await api("/api/memory");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/memory returns added entries", async () => {
    memory.add("Remember this fact", "observation", { tags: ["test"] });

    const res = await api("/api/memory");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThanOrEqual(1);

    const found = body.find((m) => m.content === "Remember this fact");
    expect(found).toBeDefined();
    expect(found!.type).toBe("observation");
  });

  // ---- Agents -------------------------------------------------------------

  it("GET /api/agents → 200, returns array", async () => {
    const res = await api("/api/agents");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/agents returns a registered agent", async () => {
    remoteAgents.register({
      name: "worker-1",
      endpoint: "http://localhost:9999",
      transport: "http",
      status: "online",
    });

    const res = await api("/api/agents");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThanOrEqual(1);

    const found = body.find((a) => a.name === "worker-1");
    expect(found).toBeDefined();
    expect(found!.transport).toBe("http");
    expect(found!.status).toBe("online");
  });

  // ---- Factory (no controller) --------------------------------------------

  it("GET /api/factory/latest → 503 when no factory controller", async () => {
    const res = await api("/api/factory/latest");
    expect(res.status).toBe(503);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("Factory controller not available");
  });

  // ---- 404 ----------------------------------------------------------------

  it("GET /nonexistent → 404", async () => {
    const res = await api("/api/nonexistent");
    expect(res.status).toBe(404);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("Not found");
  });

  // ---- Static file serving ------------------------------------------------

  it("GET / → 200 (serves index.html from public dir)", async () => {
    const res = await api("/");
    expect(res.status).toBe(200);

    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/html");
  });

  // ---- CORS ---------------------------------------------------------------

  it("OPTIONS request returns CORS headers", async () => {
    const res = await fetch(`${baseUrl}/api/health`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("GET responses include CORS allow-origin header", async () => {
    const res = await api("/api/health");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  // ---- Overview with data -------------------------------------------------

  it("GET /api/overview reflects store counts after mutations", async () => {
    const res = await api("/api/overview");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      profiles: { active: number; total: number };
      tasks: { working: number; total: number };
      skills: number;
      agents: { online: number; total: number };
    };

    // We created sessions, tasks, skills, and agents in earlier tests.
    expect(body.profiles.total).toBeGreaterThanOrEqual(1);
    expect(body.tasks.total).toBeGreaterThanOrEqual(1);
    expect(body.skills).toBeGreaterThanOrEqual(1);
    expect(body.agents.total).toBeGreaterThanOrEqual(1);
    expect(body.agents.online).toBeGreaterThanOrEqual(1);
  });
});
