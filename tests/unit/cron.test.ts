import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseCronExpression,
  CronStore,
} from "../../packages/core/src/tasks/cron.js";

// Suppress log I/O during tests
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

// ─── Temp dir setup ─────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-cron-test-"));
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

// ─── parseCronExpression ────────────────────────────────────────────

describe("parseCronExpression()", () => {
  it("'* * * * *' matches any date", () => {
    const matcher = parseCronExpression("* * * * *");
    expect(matcher.matches(new Date(2026, 0, 1, 0, 0))).toBe(true);
    expect(matcher.matches(new Date(2026, 5, 15, 12, 30))).toBe(true);
    expect(matcher.matches(new Date(2026, 11, 31, 23, 59))).toBe(true);
  });

  it("matches specific minute and hour", () => {
    const matcher = parseCronExpression("30 14 * * *");
    // 14:30 on any day
    expect(matcher.matches(new Date(2026, 3, 3, 14, 30))).toBe(true);
    // 14:31 should not match
    expect(matcher.matches(new Date(2026, 3, 3, 14, 31))).toBe(false);
    // 15:30 should not match
    expect(matcher.matches(new Date(2026, 3, 3, 15, 30))).toBe(false);
  });

  it("matches specific day of month", () => {
    const matcher = parseCronExpression("0 0 15 * *");
    // Midnight on the 15th
    expect(matcher.matches(new Date(2026, 3, 15, 0, 0))).toBe(true);
    // Midnight on the 14th
    expect(matcher.matches(new Date(2026, 3, 14, 0, 0))).toBe(false);
  });

  it("matches specific month", () => {
    // Every minute in January
    const matcher = parseCronExpression("* * * 1 *");
    expect(matcher.matches(new Date(2026, 0, 1, 0, 0))).toBe(true); // Jan
    expect(matcher.matches(new Date(2026, 1, 1, 0, 0))).toBe(false); // Feb
  });

  it("matches specific weekday (0 = Sunday)", () => {
    const matcher = parseCronExpression("* * * * 0");
    // April 5, 2026 is a Sunday
    expect(matcher.matches(new Date(2026, 3, 5, 0, 0))).toBe(true);
    // April 6, 2026 is a Monday
    expect(matcher.matches(new Date(2026, 3, 6, 0, 0))).toBe(false);
  });

  it("supports comma-separated values", () => {
    const matcher = parseCronExpression("0,30 * * * *");
    expect(matcher.matches(new Date(2026, 0, 1, 12, 0))).toBe(true);
    expect(matcher.matches(new Date(2026, 0, 1, 12, 30))).toBe(true);
    expect(matcher.matches(new Date(2026, 0, 1, 12, 15))).toBe(false);
  });

  it("supports ranges", () => {
    const matcher = parseCronExpression("* 9-17 * * *");
    expect(matcher.matches(new Date(2026, 0, 1, 9, 0))).toBe(true);
    expect(matcher.matches(new Date(2026, 0, 1, 17, 0))).toBe(true);
    expect(matcher.matches(new Date(2026, 0, 1, 8, 0))).toBe(false);
    expect(matcher.matches(new Date(2026, 0, 1, 18, 0))).toBe(false);
  });

  it("supports step values", () => {
    const matcher = parseCronExpression("*/15 * * * *");
    expect(matcher.matches(new Date(2026, 0, 1, 0, 0))).toBe(true);
    expect(matcher.matches(new Date(2026, 0, 1, 0, 15))).toBe(true);
    expect(matcher.matches(new Date(2026, 0, 1, 0, 30))).toBe(true);
    expect(matcher.matches(new Date(2026, 0, 1, 0, 45))).toBe(true);
    expect(matcher.matches(new Date(2026, 0, 1, 0, 10))).toBe(false);
  });

  it("throws for invalid expression (wrong number of fields)", () => {
    expect(() => parseCronExpression("* * *")).toThrow(/expected 5 fields/);
  });
});

// ─── CronStore ──────────────────────────────────────────────────────

describe("CronStore", () => {
  let cronStore: CronStore;

  beforeEach(() => {
    cronStore = new CronStore();
  });

  describe("create()", () => {
    it("returns a cron job with a UUID id", () => {
      const job = cronStore.create("daily-check", "0 0 * * *", {
        description: "Daily check",
      });
      expect(job.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("persists the job to disk", () => {
      cronStore.create("daily", "0 0 * * *", {});
      const filePath = path.join(tmpDir, "tasks", "crons.json");
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("sets enabled to true by default", () => {
      const job = cronStore.create("daily", "0 0 * * *", {});
      expect(job.enabled).toBe(true);
    });

    it("stores the schedule and name", () => {
      const job = cronStore.create("nightly", "0 2 * * *", {});
      expect(job.name).toBe("nightly");
      expect(job.schedule).toBe("0 2 * * *");
    });

    it("throws for an invalid cron expression", () => {
      expect(() =>
        cronStore.create("bad", "not a cron", {}),
      ).toThrow();
    });
  });

  describe("delete()", () => {
    it("removes a cron job and returns true", () => {
      const job = cronStore.create("to-delete", "* * * * *", {});
      expect(cronStore.delete(job.id)).toBe(true);
      expect(cronStore.list()).toHaveLength(0);
    });

    it("returns false for non-existent ID", () => {
      expect(cronStore.delete("non-existent")).toBe(false);
    });
  });

  describe("list()", () => {
    it("returns all cron jobs", () => {
      cronStore.create("job-a", "0 0 * * *", {});
      cronStore.create("job-b", "0 12 * * *", {});
      expect(cronStore.list()).toHaveLength(2);
    });

    it("returns empty array when no jobs exist", () => {
      expect(cronStore.list()).toHaveLength(0);
    });
  });

  describe("getNextDue()", () => {
    it("returns jobs whose schedule matches the current time", () => {
      // Create a job that matches every minute
      cronStore.create("always-due", "* * * * *", {});
      const due = cronStore.getNextDue();
      expect(due).toHaveLength(1);
      expect(due[0].name).toBe("always-due");
    });

    it("excludes disabled jobs", () => {
      const job = cronStore.create("disabled-job", "* * * * *", {});
      cronStore.update(job.id, { enabled: false });
      const due = cronStore.getNextDue();
      expect(due).toHaveLength(0);
    });

    it("excludes jobs that don't match the current time", () => {
      // Create a job for a specific minute that's unlikely to be now
      const now = new Date();
      const unlikelyMinute = (now.getMinutes() + 30) % 60;
      const unlikelyHour = (now.getHours() + 12) % 24;
      cronStore.create(
        "unlikely",
        `${unlikelyMinute} ${unlikelyHour} * * *`,
        {},
      );
      const due = cronStore.getNextDue();
      expect(due).toHaveLength(0);
    });
  });
});
