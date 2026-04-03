/**
 * CronStore — JSON file-backed cron job persistence and simple cron parser
 * for ARC Phase 17.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getArcDir } from "../paths.js";
import { writeLogEvent } from "../logging.js";
import type { CronJob, Task } from "./types.js";

// ---------------------------------------------------------------------------
// Cron expression parser
// ---------------------------------------------------------------------------

interface CronMatcher {
  matches(date: Date): boolean;
}

/**
 * Parse a standard 5-field cron expression (`minute hour day month weekday`).
 *
 * Supports:
 * - `*` (any)
 * - Exact numbers (e.g. `5`, `14`)
 * - Comma-separated lists (e.g. `1,15`)
 * - Ranges (e.g. `1-5`)
 * - Step values (e.g. `* /10` without the space — every 10)
 *
 * Does NOT support advanced features like `L`, `W`, `#`, or named months/days.
 */
export function parseCronExpression(expr: string): CronMatcher {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  const [minuteExpr, hourExpr, dayExpr, monthExpr, weekdayExpr] = parts;

  const matchers = [
    buildFieldMatcher(minuteExpr, 0, 59),
    buildFieldMatcher(hourExpr, 0, 23),
    buildFieldMatcher(dayExpr, 1, 31),
    buildFieldMatcher(monthExpr, 1, 12),
    buildFieldMatcher(weekdayExpr, 0, 6),
  ];

  return {
    matches(date: Date): boolean {
      const values = [
        date.getMinutes(),
        date.getHours(),
        date.getDate(),
        date.getMonth() + 1, // JS months are 0-based
        date.getDay(),
      ];

      return matchers.every((matcher, i) => matcher.has(values[i]));
    },
  };
}

/** Build a Set of allowed values for a single cron field. */
function buildFieldMatcher(field: string, min: number, max: number): Set<number> {
  const allowed = new Set<number>();

  for (const part of field.split(",")) {
    // Step values: */N or M-N/S
    if (part.includes("/")) {
      const [rangeExpr, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) {
        throw new Error(`Invalid step value: ${stepStr}`);
      }

      let rangeMin = min;
      let rangeMax = max;

      if (rangeExpr !== "*") {
        if (rangeExpr.includes("-")) {
          const [lo, hi] = rangeExpr.split("-").map(Number);
          rangeMin = lo;
          rangeMax = hi;
        } else {
          rangeMin = parseInt(rangeExpr, 10);
        }
      }

      for (let v = rangeMin; v <= rangeMax; v += step) {
        allowed.add(v);
      }
    } else if (part === "*") {
      for (let v = min; v <= max; v++) {
        allowed.add(v);
      }
    } else if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      for (let v = lo; v <= hi; v++) {
        allowed.add(v);
      }
    } else {
      const val = parseInt(part, 10);
      if (!isNaN(val)) allowed.add(val);
    }
  }

  return allowed;
}

// ---------------------------------------------------------------------------
// CronStore
// ---------------------------------------------------------------------------

function getCronsPath(): string {
  return path.join(getArcDir(), "tasks", "crons.json");
}

interface CronsFile {
  crons: CronJob[];
}

function readCrons(): CronJob[] {
  const filePath = getCronsPath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as CronsFile;
    return Array.isArray(data.crons) ? data.crons : [];
  } catch {
    return [];
  }
}

function writeCrons(crons: CronJob[]): void {
  const dir = path.dirname(getCronsPath());
  fs.mkdirSync(dir, { recursive: true });
  const data: CronsFile = { crons };
  fs.writeFileSync(getCronsPath(), JSON.stringify(data, null, 2), "utf-8");
}

export class CronStore {
  /** Create a new cron job. Returns the created job. */
  create(name: string, schedule: string, taskTemplate: Partial<Task>): CronJob {
    // Validate the schedule is parseable
    parseCronExpression(schedule);

    const crons = readCrons();

    const job: CronJob = {
      id: crypto.randomUUID(),
      name,
      schedule,
      taskTemplate,
      enabled: true,
    };

    crons.push(job);
    writeCrons(crons);

    writeLogEvent({
      level: "info",
      component: "cron",
      action: "create",
      message: `Cron job '${name}' created with schedule '${schedule}'.`,
      data: { cronId: job.id, schedule },
    });

    return job;
  }

  /** Delete a cron job by ID. Returns true if it existed. */
  delete(id: string): boolean {
    const crons = readCrons();
    const filtered = crons.filter((c) => c.id !== id);
    const existed = filtered.length < crons.length;

    if (existed) {
      writeCrons(filtered);
      writeLogEvent({
        level: "info",
        component: "cron",
        action: "delete",
        message: `Cron job '${id}' deleted.`,
        data: { cronId: id },
      });
    }

    return existed;
  }

  /** List all cron jobs. */
  list(): CronJob[] {
    return readCrons();
  }

  /** Update fields on an existing cron job. Returns the updated job, or null if not found. */
  update(id: string, fields: Partial<Pick<CronJob, "name" | "schedule" | "enabled" | "lastRun" | "nextRun" | "taskTemplate">>): CronJob | null {
    const crons = readCrons();
    const idx = crons.findIndex((c) => c.id === id);
    if (idx === -1) return null;

    // Validate schedule if it's being changed
    if (fields.schedule) {
      parseCronExpression(fields.schedule);
    }

    Object.assign(crons[idx], fields);
    writeCrons(crons);

    writeLogEvent({
      level: "info",
      component: "cron",
      action: "update",
      message: `Cron job '${id}' updated.`,
      data: { cronId: id, fields: Object.keys(fields) },
    });

    return crons[idx];
  }

  /**
   * Get all enabled cron jobs whose schedule matches the current time
   * (truncated to the current minute).
   */
  getNextDue(): CronJob[] {
    const now = new Date();
    const crons = readCrons();
    const due: CronJob[] = [];

    for (const job of crons) {
      if (!job.enabled) continue;
      try {
        const matcher = parseCronExpression(job.schedule);
        if (matcher.matches(now)) {
          due.push(job);
        }
      } catch {
        // Skip unparseable schedules.
      }
    }

    return due;
  }
}
