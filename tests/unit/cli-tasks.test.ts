import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TaskStore } from "../../packages/core/src/tasks/task-store.js";

// Suppress log I/O during tests
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

// ─── Temp dir setup ─────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-cli-tasks-test-"));
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

describe("CLI tasks: TaskStore operations", () => {
  let store: TaskStore;

  beforeEach(() => {
    store = new TaskStore();
  });

  // ── list ──────────────────────────────────────────────────────

  describe("list()", () => {
    it("returns empty array when store is empty", () => {
      expect(store.list()).toEqual([]);
    });

    it("returns all tasks after creation", () => {
      store.create("First task");
      store.create("Second task");
      const tasks = store.list();
      expect(tasks).toHaveLength(2);
      expect(tasks[0].description).toBe("First task");
      expect(tasks[1].description).toBe("Second task");
    });

    it("filters by status", () => {
      const t1 = store.create("Task A");
      store.create("Task B");
      store.update(t1.id, { status: "working" });

      const working = store.list({ status: "working" });
      expect(working).toHaveLength(1);
      expect(working[0].status).toBe("working");
      expect(working[0].description).toBe("Task A");
    });

    it("filters by assignee", () => {
      store.create("Alice task", { assignee: "alice" });
      store.create("Bob task", { assignee: "bob" });

      const aliceTasks = store.list({ assignee: "alice" });
      expect(aliceTasks).toHaveLength(1);
      expect(aliceTasks[0].assignee).toBe("alice");
    });

    it("filters by priority", () => {
      store.create("Low task", { priority: "low" });
      store.create("High task", { priority: "high" });

      const high = store.list({ priority: "high" });
      expect(high).toHaveLength(1);
      expect(high[0].description).toBe("High task");
    });
  });

  // ── create ────────────────────────────────────────────────────

  describe("create()", () => {
    it("creates a task with correct description", () => {
      const task = store.create("Build the widget");
      expect(task.description).toBe("Build the widget");
      expect(task.status).toBe("created");
    });

    it("respects priority option", () => {
      const task = store.create("Urgent task", { priority: "critical" });
      expect(task.priority).toBe("critical");
    });

    it("respects assignee option", () => {
      const task = store.create("Assigned task", { assignee: "agent-1" });
      expect(task.assignee).toBe("agent-1");
    });

    it("persists to disk", () => {
      store.create("Persistent check");
      const store2 = new TaskStore();
      const tasks = store2.list();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].description).toBe("Persistent check");
      expect(tasks[0].status).toBe("created");
    });
  });

  // ── update ────────────────────────────────────────────────────

  describe("update()", () => {
    it("updates task status to completed", () => {
      const task = store.create("Complete me");
      const updated = store.update(task.id, { status: "completed" });

      expect(updated).toBeDefined();
      expect(updated!.status).toBe("completed");

      const completed = store.list({ status: "completed" });
      expect(completed).toHaveLength(1);
      expect(completed[0].status).toBe("completed");
    });

    it("returns undefined for non-existent task ID", () => {
      expect(store.update("non-existent-id", { status: "working" })).toBeUndefined();
    });
  });

  // ── stop ──────────────────────────────────────────────────────

  describe("stop()", () => {
    it("cancels a task", () => {
      const task = store.create("Cancel me");
      const stopped = store.stop(task.id);
      expect(stopped).toBeDefined();
      expect(stopped!.status).toBe("cancelled");

      const tasks = store.list();
      expect(tasks[0].status).toBe("cancelled");
    });

    it("returns undefined for non-existent task ID", () => {
      expect(store.stop("bad-id")).toBeUndefined();
    });
  });
});
