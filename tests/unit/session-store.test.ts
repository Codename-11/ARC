import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SessionStore,
  isResumeIntent,
} from "../../packages/core/src/sessions.js";

// Suppress log I/O during tests
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

// ─── Temp dir setup ─────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-session-test-"));
  process.env["ARC_DIR"] = tmpDir;
});

afterEach(() => {
  delete process.env["ARC_DIR"];
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

// ─── Tests ──────────────────────────────────────────────────────────

describe("SessionStore", () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore();
  });

  // ── create ────────────────────────────────────────────────────

  describe("create()", () => {
    it("returns a session with a UUID id", () => {
      const session = store.create("my-session", "default", "claude");
      expect(session.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("returns a session with status 'active'", () => {
      const session = store.create("my-session", "default", "claude");
      expect(session.status).toBe("active");
    });

    it("sets name, profile, and adapter", () => {
      const session = store.create("coding", "work", "gemini");
      expect(session.name).toBe("coding");
      expect(session.profile).toBe("work");
      expect(session.adapter).toBe("gemini");
    });

    it("sets created and lastActive timestamps", () => {
      const session = store.create("my-session", "default", "claude");
      expect(session.created).toBeDefined();
      expect(session.lastActive).toBeDefined();
    });
  });

  // ── suspend / resume / complete lifecycle ─────────────────────

  describe("lifecycle: suspend → resume → complete", () => {
    it("suspend() sets status to 'suspended'", () => {
      const session = store.create("my-session", "default", "claude");
      const suspended = store.suspend(session.id);
      expect(suspended.status).toBe("suspended");
    });

    it("resume() sets status back to 'active'", () => {
      const session = store.create("my-session", "default", "claude");
      store.suspend(session.id);
      const resumed = store.resume(session.id);
      expect(resumed.status).toBe("active");
    });

    it("resume() throws when session is not suspended", () => {
      const session = store.create("my-session", "default", "claude");
      expect(() => store.resume(session.id)).toThrow(/not suspended/);
    });

    it("complete() sets status to 'completed'", () => {
      const session = store.create("my-session", "default", "claude");
      const completed = store.complete(session.id);
      expect(completed.status).toBe("completed");
    });

    it("full lifecycle: active → suspended → active → completed", () => {
      const session = store.create("lifecycle", "default", "claude");
      expect(session.status).toBe("active");

      const s1 = store.suspend(session.id);
      expect(s1.status).toBe("suspended");

      const s2 = store.resume(session.id);
      expect(s2.status).toBe("active");

      const s3 = store.complete(session.id);
      expect(s3.status).toBe("completed");
    });
  });

  // ── getActive ─────────────────────────────────────────────────

  describe("getActive()", () => {
    it("returns only active sessions", () => {
      store.create("s1", "default", "claude");
      const s2 = store.create("s2", "default", "claude");
      store.create("s3", "default", "claude");
      store.suspend(s2.id);

      const active = store.getActive();
      expect(active).toHaveLength(2);
      expect(active.every((s) => s.status === "active")).toBe(true);
    });

    it("returns empty array when no sessions are active", () => {
      const s = store.create("s1", "default", "claude");
      store.suspend(s.id);
      expect(store.getActive()).toHaveLength(0);
    });
  });

  // ── getLastSuspended ──────────────────────────────────────────

  describe("getLastSuspended()", () => {
    it("returns null when no suspended sessions exist", () => {
      store.create("active-session", "default", "claude");
      expect(store.getLastSuspended()).toBeNull();
    });

    it("returns the most recently suspended session", () => {
      const s1 = store.create("first", "default", "claude");
      const s2 = store.create("second", "default", "claude");

      store.suspend(s1.id);
      store.suspend(s2.id);

      const last = store.getLastSuspended();
      expect(last).not.toBeNull();
      expect(last!.id).toBe(s2.id);
    });
  });

  // ── list with filters ─────────────────────────────────────────

  describe("list()", () => {
    it("returns all sessions without a filter", () => {
      store.create("s1", "default", "claude");
      store.create("s2", "work", "gemini");
      expect(store.list()).toHaveLength(2);
    });

    it("filters by profile", () => {
      store.create("s1", "default", "claude");
      store.create("s2", "work", "gemini");
      const work = store.list({ profile: "work" });
      expect(work).toHaveLength(1);
      expect(work[0].profile).toBe("work");
    });

    it("filters by adapter", () => {
      store.create("s1", "default", "claude");
      store.create("s2", "work", "gemini");
      const gemini = store.list({ adapter: "gemini" });
      expect(gemini).toHaveLength(1);
      expect(gemini[0].adapter).toBe("gemini");
    });

    it("filters by status", () => {
      const s1 = store.create("s1", "default", "claude");
      store.create("s2", "work", "gemini");
      store.suspend(s1.id);

      const suspended = store.list({ status: "suspended" });
      expect(suspended).toHaveLength(1);
      expect(suspended[0].id).toBe(s1.id);
    });
  });

  // ── update throws on missing session ──────────────────────────

  describe("update()", () => {
    it("throws when session ID does not exist", () => {
      expect(() => store.update("non-existent", { name: "new" })).toThrow(
        /not found/,
      );
    });
  });
});

// ─── isResumeIntent ─────────────────────────────────────────────────

describe("isResumeIntent()", () => {
  it.each([
    "continue",
    "Continue working",
    "please resume",
    "Resume the task",
    "keep going",
    "Keep going with that",
    "pick up where we left off",
    "carry on",
    "where we left off",
  ])("detects resume intent in: '%s'", (input) => {
    expect(isResumeIntent(input)).toBe(true);
  });

  it.each([
    "start a new session",
    "hello",
    "what is the weather",
    "build me a widget",
    "",
  ])("does not detect resume intent in: '%s'", (input) => {
    expect(isResumeIntent(input)).toBe(false);
  });
});
