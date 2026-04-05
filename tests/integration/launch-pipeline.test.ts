import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Suppress disk I/O from logging
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

import { SessionStore, isResumeIntent } from "../../packages/core/src/sessions.js";
import {
  TelemetryProvider,
  JsonFileExporter,
  startSessionSpan,
  startPreflightSpan,
  startHookSpan,
  startAgentExecutionSpan,
  startPostflightSpan,
  startCircuitBreakerSpan,
} from "../../packages/core/src/telemetry/index.js";
import { CircuitBreaker } from "../../packages/core/src/circuit-breaker.js";
import { SkillRegistry, loadSkillsFromDirectory } from "../../packages/core/src/skills/index.js";
import { PersistentMemory, extractMemories } from "../../packages/core/src/memory/index.js";

// ── Temp dir setup ─────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-launch-test-"));
  process.env["ARC_DIR"] = tmpDir;
});

afterEach(() => {
  delete process.env["ARC_DIR"];
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* best effort */ }
});

// ── Session lifecycle during launch ────────────────────────────────────

describe("session lifecycle during launch", () => {
  it("creates a session that can be retrieved by ID", () => {
    const store = new SessionStore();
    const session = store.create("launch-session", "default", "claude");

    const retrieved = store.get(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe("launch-session");
    expect(retrieved!.status).toBe("active");
  });

  it("completes a session and verifies it persists in the store", () => {
    const store = new SessionStore();
    const session = store.create("work-session", "dev", "gemini");
    store.complete(session.id);

    const completed = store.get(session.id);
    expect(completed!.status).toBe("completed");
    expect(completed!.profile).toBe("dev");
    expect(completed!.adapter).toBe("gemini");
  });

  it("session data survives across SessionStore instances (file-backed)", () => {
    const store1 = new SessionStore();
    const session = store1.create("persistent", "default", "claude");
    store1.complete(session.id);

    // New store instance reads from the same file
    const store2 = new SessionStore();
    const retrieved = store2.get(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.status).toBe("completed");
  });

  it("launch creates session, runs work, then completes — full flow", () => {
    const store = new SessionStore();

    // Simulate launch: create session
    const session = store.create("full-flow", "work", "claude");
    expect(session.status).toBe("active");

    // Simulate work: update with metadata
    store.update(session.id, {
      metadata: { command: "arc launch claude", cwd: "/projects/app" },
    });

    // Simulate completion
    const completed = store.complete(session.id);
    expect(completed.status).toBe("completed");
    expect(completed.metadata?.command).toBe("arc launch claude");
  });
});

// ── Telemetry spans during launch ──────────────────────────────────────

describe("telemetry spans during launch", () => {
  it("creates a session span with correct attributes", () => {
    const provider = new TelemetryProvider();
    const spanId = startSessionSpan(provider, "sess-123", "default", "claude", "advise");

    expect(spanId).toBeTruthy();
    const span = provider.getSpan(spanId);
    expect(span).toBeDefined();
    expect(span!.name).toBe("arc.session");
    expect(span!.attributes["arc.session_id"]).toBe("sess-123");
    expect(span!.attributes["arc.profile"]).toBe("default");
    expect(span!.attributes["arc.adapter"]).toBe("claude");
    expect(span!.attributes["arc.enforcement_mode"]).toBe("advise");
  });

  it("builds a full span hierarchy: session > preflight > hook", () => {
    const provider = new TelemetryProvider();
    const sessionId = startSessionSpan(provider, "s1", "dev", "gemini", "enforce");
    const preflightId = startPreflightSpan(provider, sessionId);
    const hookId = startHookSpan(provider, preflightId, "risk-detection");

    const hook = provider.getSpan(hookId);
    expect(hook!.parentId).toBe(preflightId);
    expect(hook!.name).toBe("arc.hook.risk-detection");

    const preflight = provider.getSpan(preflightId);
    expect(preflight!.parentId).toBe(sessionId);
  });

  it("ends spans and flushes to JsonFileExporter", async () => {
    const traceDir = path.join(tmpDir, "traces");
    const exporter = new JsonFileExporter(traceDir);
    const provider = new TelemetryProvider();
    provider.addExporter(exporter);

    const sessionSpanId = startSessionSpan(provider, "s2", "default", "claude", "log");
    const execSpanId = startAgentExecutionSpan(provider, sessionSpanId);

    provider.endSpan(execSpanId, "ok");
    provider.endSpan(sessionSpanId, "ok");

    await provider.flush();

    const tracePath = exporter.getFilePath();
    expect(fs.existsSync(tracePath)).toBe(true);

    const lines = fs.readFileSync(tracePath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const spans = lines.map((l) => JSON.parse(l));
    const names = spans.map((s: { name: string }) => s.name);
    expect(names).toContain("arc.session");
    expect(names).toContain("arc.agent.execution");
  });

  it("shutdown ends open spans with error status and flushes", async () => {
    const traceDir = path.join(tmpDir, "traces-shutdown");
    const exporter = new JsonFileExporter(traceDir);
    const provider = new TelemetryProvider();
    provider.addExporter(exporter);

    startSessionSpan(provider, "s3", "default", "claude", "log");
    // Span left open intentionally

    await provider.shutdown();

    const tracePath = exporter.getFilePath();
    const lines = fs.readFileSync(tracePath, "utf-8").trim().split("\n");
    const span = JSON.parse(lines[0]);
    expect(span.status).toBe("error");
    expect(span.endTime).toBeDefined();
  });

  it("all spans share the same traceId", () => {
    const provider = new TelemetryProvider();
    const sessionId = startSessionSpan(provider, "s4", "default", "claude", "log");
    const preflightId = startPreflightSpan(provider, sessionId);
    const postflightId = startPostflightSpan(provider, sessionId);

    const traceId = provider.getTraceId();
    expect(provider.getSpan(sessionId)!.traceId).toBe(traceId);
    expect(provider.getSpan(preflightId)!.traceId).toBe(traceId);
    expect(provider.getSpan(postflightId)!.traceId).toBe(traceId);
  });
});

// ── Circuit breaker during launch ──────────────────────────────────────

describe("circuit breaker during launch", () => {
  it("degrades enforcement after consecutive failures", () => {
    const cb = new CircuitBreaker({ maxConsecutiveFailures: 2 });

    expect(cb.getEffectiveEnforcement("enforce")).toBe("enforce");

    cb.recordFailure();
    cb.recordFailure();

    expect(cb.isTripped()).toBe(true);
    expect(cb.getEffectiveEnforcement("enforce")).toBe("log");
    expect(cb.getEffectiveEnforcement("advise")).toBe("log");
    expect(cb.getEffectiveEnforcement("log")).toBe("log");
    expect(cb.getEffectiveEnforcement("off")).toBe("off");

    cb.reset();
  });

  it("manual reset restores normal enforcement", () => {
    const cb = new CircuitBreaker({ maxConsecutiveFailures: 1 });
    cb.recordFailure();
    expect(cb.isTripped()).toBe(true);

    cb.reset();
    expect(cb.isTripped()).toBe(false);
    expect(cb.getEffectiveEnforcement("enforce")).toBe("enforce");
  });

  it("circuit breaker span is created when breaker trips", () => {
    const provider = new TelemetryProvider();
    const sessionSpanId = startSessionSpan(provider, "cb-sess", "default", "claude", "enforce");

    const cb = new CircuitBreaker({ maxConsecutiveFailures: 2 });
    cb.recordFailure();
    cb.recordFailure();

    // Record the trip in telemetry
    const cbSpanId = startCircuitBreakerSpan(provider, sessionSpanId, cb.getState().failures);
    provider.endSpan(cbSpanId, "error");

    const span = provider.getSpan(cbSpanId);
    expect(span!.name).toBe("arc.circuit-breaker");
    expect(span!.attributes["arc.circuit_breaker.failures"]).toBe(2);
    expect(span!.parentId).toBe(sessionSpanId);

    cb.reset();
  });
});

// ── Skills auto-load ───────────────────────────────────────────────────

describe("skills auto-load during launch", () => {
  it("loads skill definitions from a directory into the registry", async () => {
    const skillsDir = path.join(tmpDir, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });

    // Write two skill definition files
    fs.writeFileSync(
      path.join(skillsDir, "refactor.json"),
      JSON.stringify({
        name: "refactor",
        description: "Refactor code for clarity",
        trigger: ["refactor", "clean up"],
        steps: [{ action: "analyze", description: "Analyze code", onError: "abort" }],
        tools: ["read", "edit"],
        adapters: [],
        source: "user",
        created: "2025-01-01T00:00:00Z",
        successRate: 0.9,
      }),
    );

    fs.writeFileSync(
      path.join(skillsDir, "deploy.json"),
      JSON.stringify({
        name: "deploy",
        description: "Deploy to production",
        trigger: ["deploy", "ship it"],
        steps: [],
        tools: ["bash"],
        adapters: ["claude"],
        source: "user",
        created: "2025-01-01T00:00:00Z",
        successRate: 0.85,
      }),
    );

    const skills = await loadSkillsFromDirectory(skillsDir);
    expect(skills).toHaveLength(2);

    const registry = new SkillRegistry();
    for (const skill of skills) {
      registry.register(skill);
    }

    expect(registry.list()).toHaveLength(2);
    expect(registry.get("refactor")).toBeDefined();
    expect(registry.get("deploy")).toBeDefined();
  });

  it("trigger matching works after auto-load", async () => {
    const skillsDir = path.join(tmpDir, "skills-trigger");
    fs.mkdirSync(skillsDir, { recursive: true });

    fs.writeFileSync(
      path.join(skillsDir, "test-skill.json"),
      JSON.stringify({
        name: "test-runner",
        description: "Run tests",
        trigger: ["run tests", "test suite"],
        steps: [],
        tools: [],
        adapters: [],
        source: "user",
        created: "2025-01-01T00:00:00Z",
        successRate: 0.95,
      }),
    );

    const skills = await loadSkillsFromDirectory(skillsDir);
    const registry = new SkillRegistry();
    for (const skill of skills) {
      registry.register(skill);
    }

    const matches = registry.findByTrigger("please run tests on the project");
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe("test-runner");
  });

  it("skips invalid skill files without crashing", async () => {
    const skillsDir = path.join(tmpDir, "skills-invalid");
    fs.mkdirSync(skillsDir, { recursive: true });

    fs.writeFileSync(path.join(skillsDir, "bad.json"), "{ not valid json }}}");
    fs.writeFileSync(
      path.join(skillsDir, "no-name.json"),
      JSON.stringify({ description: "missing name field" }),
    );
    fs.writeFileSync(
      path.join(skillsDir, "good.json"),
      JSON.stringify({
        name: "good-skill",
        description: "Valid skill",
        trigger: [],
        steps: [],
        tools: [],
        adapters: [],
        source: "user",
        created: "2025-01-01T00:00:00Z",
        successRate: 1,
      }),
    );

    const skills = await loadSkillsFromDirectory(skillsDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("good-skill");
  });

  it("returns empty array for nonexistent skills directory", async () => {
    const skills = await loadSkillsFromDirectory(path.join(tmpDir, "nope"));
    expect(skills).toEqual([]);
  });
});

// ── Memory auto-extraction ─────────────────────────────────────────────

describe("memory auto-extraction during launch", () => {
  it("extracts corrections from conversation text", () => {
    const text = [
      "Actually, the config file is in /etc/app/config.yaml",
      "Don't use the old API endpoint",
      "The weather is nice today",
    ].join("\n");

    const memories = extractMemories(text, "session-123", "claude");
    expect(memories.length).toBeGreaterThanOrEqual(2);

    const types = memories.map((m) => m.type);
    expect(types).toContain("correction");
  });

  it("extracts preferences from user input", () => {
    const text = "I prefer TypeScript over JavaScript for all new files";
    const memories = extractMemories(text, "session-456");

    expect(memories.length).toBeGreaterThanOrEqual(1);
    expect(memories[0].type).toBe("preference");
    expect(memories[0].tags).toContain("auto-extracted");
  });

  it("extracts decisions from conversation", () => {
    const text = "Let's go with Vitest instead of Jest for the test runner";
    const memories = extractMemories(text, "session-789");

    expect(memories.length).toBeGreaterThanOrEqual(1);
    expect(memories[0].type).toBe("decision");
  });

  it("deduplicates identical content within a single extraction", () => {
    const text = [
      "Actually, use port 8080",
      "Actually, use port 8080",
      "Actually, use port 8080",
    ].join("\n");

    const memories = extractMemories(text, "dedup-session");
    expect(memories).toHaveLength(1);
  });

  it("extracted memories can be stored in PersistentMemory", () => {
    const text = "I always want semicolons in TypeScript files";
    const memories = extractMemories(text, "persist-session");
    expect(memories.length).toBeGreaterThanOrEqual(1);

    const pm = new PersistentMemory("persistent");
    for (const mem of memories) {
      pm.add(mem.content, mem.type, {
        tags: mem.tags,
        relevanceScore: mem.relevanceScore,
        sourceSession: mem.sourceSession,
        sourceAgent: mem.sourceAgent,
      });
    }

    expect(pm.size).toBe(memories.length);
    const stored = pm.list();
    expect(stored[0].content).toBe(memories[0].content);
    expect(stored[0].type).toBe(memories[0].type);
  });
});

// ── Session auto-resume detection ──────────────────────────────────────

describe("session auto-resume detection", () => {
  it("detects resume intent in 'continue working'", () => {
    expect(isResumeIntent("continue working")).toBe(true);
  });

  it("detects resume intent in 'pick up where we left off'", () => {
    expect(isResumeIntent("pick up where we left off")).toBe(true);
  });

  it("does not trigger on regular prompts", () => {
    expect(isResumeIntent("build a new feature")).toBe(false);
    expect(isResumeIntent("fix the login bug")).toBe(false);
  });

  it("finds a suspended session to resume", () => {
    const store = new SessionStore();
    const s1 = store.create("old-session", "default", "claude");
    store.suspend(s1.id);

    const lastSuspended = store.getLastSuspended();
    expect(lastSuspended).not.toBeNull();
    expect(lastSuspended!.id).toBe(s1.id);
    expect(lastSuspended!.status).toBe("suspended");
  });

  it("resume intent + suspended session = auto-resume flow", () => {
    const store = new SessionStore();
    const session = store.create("resume-target", "work", "claude");
    store.suspend(session.id);

    // Simulate launch: user says "continue working"
    const input = "continue working on the feature";
    expect(isResumeIntent(input)).toBe(true);

    const toResume = store.getLastSuspended();
    expect(toResume).not.toBeNull();

    const resumed = store.resume(toResume!.id);
    expect(resumed.status).toBe("active");
    expect(resumed.name).toBe("resume-target");
  });

  it("returns null when no sessions are suspended", () => {
    const store = new SessionStore();
    store.create("active-only", "default", "claude");

    expect(store.getLastSuspended()).toBeNull();
  });
});

// ── Cross-component integration ────────────────────────────────────────

describe("cross-component integration", () => {
  it("session + telemetry: span attributes reference the session ID", () => {
    const store = new SessionStore();
    const session = store.create("traced-session", "default", "claude");

    const provider = new TelemetryProvider();
    const spanId = startSessionSpan(provider, session.id, "default", "claude", "advise");

    const span = provider.getSpan(spanId);
    expect(span!.attributes["arc.session_id"]).toBe(session.id);
  });

  it("circuit breaker + telemetry: breaker trip is recorded as a span", async () => {
    const traceDir = path.join(tmpDir, "traces-cb");
    const exporter = new JsonFileExporter(traceDir);
    const provider = new TelemetryProvider();
    provider.addExporter(exporter);

    const sessionSpanId = startSessionSpan(provider, "cb-int", "default", "claude", "enforce");

    const cb = new CircuitBreaker({ maxConsecutiveFailures: 2 });
    cb.recordFailure();
    cb.recordFailure();

    const cbSpanId = startCircuitBreakerSpan(provider, sessionSpanId, cb.getState().failures);
    provider.endSpan(cbSpanId, "error");
    provider.endSpan(sessionSpanId, "ok");

    await provider.flush();

    const tracePath = exporter.getFilePath();
    const lines = fs.readFileSync(tracePath, "utf-8").trim().split("\n");
    const spans = lines.map((l) => JSON.parse(l));
    const cbSpan = spans.find((s: { name: string }) => s.name === "arc.circuit-breaker");
    expect(cbSpan).toBeDefined();
    expect(cbSpan.attributes["arc.circuit_breaker.failures"]).toBe(2);

    cb.reset();
  });

  it("memory + session: extracted memories reference the session", () => {
    const store = new SessionStore();
    const session = store.create("memory-session", "default", "claude");

    const text = "Actually, always use pnpm instead of npm";
    const memories = extractMemories(text, session.id, "claude");

    expect(memories.length).toBeGreaterThanOrEqual(1);
    expect(memories[0].sourceSession).toBe(session.id);
    expect(memories[0].sourceAgent).toBe("claude");
  });
});
