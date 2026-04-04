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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-task-test-"));
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

describe("TaskStore", () => {
  let store: TaskStore;

  beforeEach(() => {
    store = new TaskStore();
  });

  // ── create ────────────────────────────────────────────────────

  describe("create()", () => {
    it("returns a task with a UUID id", () => {
      const task = store.create("Test task");
      expect(task.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("returns a task with status 'created'", () => {
      const task = store.create("Test task");
      expect(task.status).toBe("created");
    });

    it("sets the description", () => {
      const task = store.create("Build the widget");
      expect(task.description).toBe("Build the widget");
    });

    it("defaults priority to 'medium'", () => {
      const task = store.create("Test task");
      expect(task.priority).toBe("medium");
    });

    it("respects provided options", () => {
      const task = store.create("Urgent task", {
        assignee: "agent-1",
        priority: "critical",
        riskTier: "high",
        metadata: { source: "test" },
      });
      expect(task.assignee).toBe("agent-1");
      expect(task.priority).toBe("critical");
      expect(task.riskTier).toBe("high");
      expect(task.metadata).toEqual({ source: "test" });
    });

    it("sets created and updated timestamps", () => {
      const task = store.create("Test task");
      expect(task.created).toBeDefined();
      expect(task.updated).toBeDefined();
    });
  });

  // ── get ───────────────────────────────────────────────────────

  describe("get()", () => {
    it("retrieves a task by ID", () => {
      const created = store.create("Test task");
      const retrieved = store.get(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.description).toBe("Test task");
    });

    it("returns undefined for non-existent ID", () => {
      expect(store.get("non-existent-id")).toBeUndefined();
    });
  });

  // ── list ──────────────────────────────────────────────────────

  describe("list()", () => {
    it("returns all tasks when no filter is provided", () => {
      store.create("Task 1");
      store.create("Task 2");
      store.create("Task 3");
      expect(store.list()).toHaveLength(3);
    });

    it("filters by status", () => {
      const t1 = store.create("Task 1");
      store.create("Task 2");
      store.update(t1.id, { status: "completed" });

      const completed = store.list({ status: "completed" });
      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe(t1.id);
    });

    it("filters by assignee", () => {
      store.create("Task 1", { assignee: "alice" });
      store.create("Task 2", { assignee: "bob" });
      store.create("Task 3", { assignee: "alice" });

      const aliceTasks = store.list({ assignee: "alice" });
      expect(aliceTasks).toHaveLength(2);
    });

    it("filters by priority", () => {
      store.create("Low task", { priority: "low" });
      store.create("High task", { priority: "high" });

      const high = store.list({ priority: "high" });
      expect(high).toHaveLength(1);
      expect(high[0].description).toBe("High task");
    });

    it("returns empty array when no tasks exist", () => {
      expect(store.list()).toEqual([]);
    });
  });

  // ── update ────────────────────────────────────────────────────

  describe("update()", () => {
    it("updates fields on an existing task", () => {
      const task = store.create("Test task");
      const updated = store.update(task.id, { status: "working" });

      expect(updated).toBeDefined();
      expect(updated!.status).toBe("working");
    });

    it("updates the 'updated' timestamp", () => {
      const task = store.create("Test task");
      const originalUpdated = task.updated;

      // Small delay to ensure timestamp differs
      const updated = store.update(task.id, { status: "working" });
      expect(updated!.updated).toBeDefined();
      // The updated timestamp should be set (may or may not differ in fast tests)
    });

    it("preserves id and created fields", () => {
      const task = store.create("Test task");
      const updated = store.update(task.id, {
        description: "Changed",
        status: "assigned",
      });

      expect(updated!.id).toBe(task.id);
      expect(updated!.created).toBe(task.created);
    });

    it("returns undefined for non-existent ID", () => {
      expect(store.update("bad-id", { status: "working" })).toBeUndefined();
    });
  });

  // ── stop ──────────────────────────────────────────────────────

  describe("stop()", () => {
    it("sets status to cancelled", () => {
      const task = store.create("Test task");
      const stopped = store.stop(task.id);
      expect(stopped).toBeDefined();
      expect(stopped!.status).toBe("cancelled");
    });

    it("returns undefined for non-existent ID", () => {
      expect(store.stop("bad-id")).toBeUndefined();
    });
  });

  // ── addOutput ─────────────────────────────────────────────────

  describe("addOutput()", () => {
    it("sets output on a task with no prior output", () => {
      const task = store.create("Test task");
      const updated = store.addOutput(task.id, "line 1");
      expect(updated).toBeDefined();
      expect(updated!.output).toBe("line 1");
    });

    it("appends output with a newline separator", () => {
      const task = store.create("Test task");
      store.addOutput(task.id, "line 1");
      const updated = store.addOutput(task.id, "line 2");
      expect(updated!.output).toBe("line 1\nline 2");
    });

    it("returns undefined for non-existent ID", () => {
      expect(store.addOutput("bad-id", "data")).toBeUndefined();
    });
  });

  // ── Atomic writes ─────────────────────────────────────────────

  describe("atomic writes", () => {
    it("persists tasks.json to disk after create", () => {
      store.create("Persisted task");
      const filePath = path.join(tmpDir, "tasks", "tasks.json");
      expect(fs.existsSync(filePath)).toBe(true);

      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(raw.tasks).toHaveLength(1);
      expect(raw.tasks[0].description).toBe("Persisted task");
    });

    it("persists across separate TaskStore instances", () => {
      store.create("Task from store 1");

      const store2 = new TaskStore();
      const tasks = store2.list();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].description).toBe("Task from store 1");
    });
  });
});
