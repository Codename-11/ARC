import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SessionStore } from "../../packages/core/src/sessions.js";

// Suppress log I/O during tests
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

// ─── Temp dir setup ─────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-cli-sessions-test-"));
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

// ─── Helper to seed sessions directly via the store ─────────────────

function seedSessions(): SessionStore {
  const store = new SessionStore();
  store.create("coding-session", "default", "claude");
  store.create("research", "work", "gemini");
  return store;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("CLI sessions: SessionStore operations", () => {
  // ── list ──────────────────────────────────────────────────────

  describe("list()", () => {
    it("returns empty array when store is empty", () => {
      const store = new SessionStore();
      expect(store.list()).toEqual([]);
    });

    it("returns all sessions after seeding", () => {
      seedSessions();
      const store = new SessionStore();
      const sessions = store.list();
      expect(sessions).toHaveLength(2);
      expect(sessions.some((s) => s.name === "coding-session")).toBe(true);
      expect(sessions.some((s) => s.name === "research")).toBe(true);
    });

    it("sessions have expected properties", () => {
      seedSessions();
      const store = new SessionStore();
      const sessions = store.list();
      expect(sessions[0]).toHaveProperty("name");
      expect(sessions[0]).toHaveProperty("profile");
      expect(sessions[0]).toHaveProperty("adapter");
    });

    it("filters by status active", () => {
      const store = seedSessions();
      const sessions = store.list();
      store.suspend(sessions[0].id);

      const active = store.list({ status: "active" });
      expect(active).toHaveLength(1);
      expect(active[0].status).toBe("active");
      expect(active[0].name).toBe("research");
    });

    it("filters by status suspended", () => {
      const store = seedSessions();
      const sessions = store.list();
      store.suspend(sessions[0].id);

      const suspended = store.list({ status: "suspended" });
      expect(suspended).toHaveLength(1);
      expect(suspended[0].status).toBe("suspended");
    });

    it("filters by profile", () => {
      seedSessions();
      const store = new SessionStore();
      const work = store.list({ profile: "work" });
      expect(work).toHaveLength(1);
      expect(work[0].profile).toBe("work");
    });
  });

  // ── resume ────────────────────────────────────────────────────

  describe("resume()", () => {
    it("getLastSuspended returns null when no suspended sessions exist", () => {
      const store = new SessionStore();
      store.create("active-session", "default", "claude");
      expect(store.getLastSuspended()).toBeNull();
    });

    it("resumes the last suspended session", () => {
      const store = seedSessions();
      const sessions = store.list();
      store.suspend(sessions[0].id);

      const last = store.getLastSuspended();
      expect(last).not.toBeNull();
      expect(last!.name).toBe("coding-session");

      const resumed = store.resume(last!.id);
      expect(resumed.status).toBe("active");
      expect(resumed.name).toBe("coding-session");
    });

    it("resumes a specific session by ID", () => {
      const store = seedSessions();
      const sessions = store.list();
      store.suspend(sessions[1].id);

      const resumed = store.resume(sessions[1].id);
      expect(resumed.status).toBe("active");
      expect(resumed.name).toBe("research");
    });

    it("throws when trying to resume an active session", () => {
      const store = seedSessions();
      const sessions = store.list();
      expect(() => store.resume(sessions[0].id)).toThrow(/not suspended/);
    });
  });

  // ── complete ──────────────────────────────────────────────────

  describe("complete()", () => {
    it("marks a session as completed", () => {
      const store = seedSessions();
      const sessions = store.list();

      const completed = store.complete(sessions[0].id);
      expect(completed.status).toBe("completed");
      expect(completed.name).toBe("coding-session");
    });

    it("throws for non-existent session ID", () => {
      const store = new SessionStore();
      expect(() => store.complete("non-existent-id")).toThrow(/not found/);
    });

    it("persists the completed status across store instances", () => {
      const store = seedSessions();
      const sessions = store.list();
      store.complete(sessions[0].id);

      const store2 = new SessionStore();
      const completed = store2.list({ status: "completed" });
      expect(completed).toHaveLength(1);
      expect(completed[0].status).toBe("completed");
    });
  });
});
