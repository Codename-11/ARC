import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../packages/daemon/src/db.js";
import { migrateV2ToV3 } from "../packages/daemon/src/migrations/v2-to-v3.js";

/**
 * Fixture-based migration tests.
 *
 * Creates a synthetic ~/.arc/ layout in a tempdir with:
 *   - 3 launches in history.json
 *   - 1 chat-session JSON for a known profile
 *   - a handful of activity.log JSONL lines
 *
 * Asserts the SQLite rows that should result, verifies idempotence, and
 * checks that a dry-run does not write the db file.
 */

let tmpDir: string;

function seedV2State(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });

  const history = [
    {
      profile: "claude",
      tool: "claude",
      timestamp: "2024-01-01T10:00:00.000Z",
      outcome: "started",
    },
    {
      profile: "claude",
      tool: "claude",
      timestamp: "2024-01-01T10:05:00.000Z",
      outcome: "exited",
      exitCode: 0,
    },
    {
      profile: "codex",
      tool: "codex",
      timestamp: "2024-01-02T12:00:00.000Z",
      outcome: "failed",
      exitCode: 1,
    },
  ];
  fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(history, null, 2));

  const chatDir = path.join(dir, "profiles", "claude", "chat-sessions");
  fs.mkdirSync(chatDir, { recursive: true });
  const session = {
    id: "sess-001",
    profileName: "claude",
    permissionMode: "supervised",
    messages: [
      {
        role: "user",
        content: "hello",
        timestamp: "2024-01-01T10:00:30.000Z",
      },
      {
        role: "assistant",
        content: "hi there",
        timestamp: "2024-01-01T10:00:45.000Z",
        toolCalls: [
          {
            id: "tc-1",
            name: "list_profiles",
            input: {},
            result: { profiles: [] },
          },
        ],
      },
    ],
    createdAt: "2024-01-01T10:00:15.000Z",
    updatedAt: "2024-01-01T10:00:50.000Z",
  };
  fs.writeFileSync(
    path.join(chatDir, "sess-001.json"),
    JSON.stringify(session, null, 2),
  );

  // Activity log — JSONL.
  const activity = [
    {
      timestamp: "2024-01-01T10:01:00.000Z",
      level: "info",
      component: "launch",
      action: "profile.launch",
      profile: "claude",
      tool: "claude",
    },
    {
      timestamp: "2024-01-02T12:00:05.000Z",
      level: "error",
      component: "launch",
      action: "profile.exit",
      profile: "codex",
      tool: "codex",
      message: "failed with code 1",
    },
    // malformed line should be skipped
    "not-json-at-all",
  ];
  fs.writeFileSync(
    path.join(dir, "activity.log"),
    activity.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join("\n") + "\n",
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-migrate-v2-v3-"));
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

describe("migrateV2ToV3", () => {
  it("ingests history, chat sessions, and activity log into SQLite", async () => {
    seedV2State(tmpDir);

    const report = await migrateV2ToV3({ arcDir: tmpDir });

    expect(report.alreadyMigrated).toBe(false);
    expect(report.dryRun).toBe(false);
    expect(report.profiles).toBeGreaterThanOrEqual(2); // claude + codex
    expect(report.agents).toBe(3); // one row per history launch
    expect(report.chatMessages).toBeGreaterThanOrEqual(2); // user + assistant
    // events = chat stdout (2) + tool_call (1) + tool_result (1) + 2 activity status = 6
    expect(report.events).toBeGreaterThanOrEqual(6);

    const dbPath = path.join(tmpDir, "arc.db");
    expect(fs.existsSync(dbPath)).toBe(true);

    const db = openDb(dbPath);
    try {
      const agentCount = (db.prepare("SELECT COUNT(*) as n FROM agents").get() as {
        n: number;
      }).n;
      expect(agentCount).toBe(3);

      const claudeAgents = db
        .prepare("SELECT * FROM agents WHERE profile = ?")
        .all("claude");
      expect(claudeAgents.length).toBe(2);

      const allCompleted = (db
        .prepare("SELECT COUNT(*) as n FROM agents WHERE status = 'completed'")
        .get() as { n: number }).n;
      expect(allCompleted).toBe(3);

      const eventCount = (db
        .prepare("SELECT COUNT(*) as n FROM agent_events")
        .get() as { n: number }).n;
      expect(eventCount).toBeGreaterThanOrEqual(6);

      const kinds = db
        .prepare("SELECT DISTINCT kind FROM agent_events")
        .all() as Array<{ kind: string }>;
      const kindSet = new Set(kinds.map((k) => k.kind));
      expect(kindSet.has("stdout")).toBe(true);
      expect(kindSet.has("tool_call")).toBe(true);
      expect(kindSet.has("tool_result")).toBe(true);
      expect(kindSet.has("status")).toBe(true);

      const marker = db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("migration_v2_to_v3_completed_at") as { value: string } | undefined;
      expect(marker).toBeDefined();
      expect(typeof marker?.value).toBe("string");

      // All events should use epoch=1 as per spec.
      const epochs = db
        .prepare("SELECT DISTINCT epoch FROM agent_events")
        .all() as Array<{ epoch: number }>;
      expect(epochs.every((e) => e.epoch === 1)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("is idempotent — a second run reports already migrated and writes nothing new", async () => {
    seedV2State(tmpDir);

    const first = await migrateV2ToV3({ arcDir: tmpDir });
    expect(first.alreadyMigrated).toBe(false);
    const firstAgents = first.agents;

    // Sanity: count rows after first run.
    const dbPath = path.join(tmpDir, "arc.db");
    const db1 = openDb(dbPath);
    const beforeAgents = (db1.prepare("SELECT COUNT(*) as n FROM agents").get() as {
      n: number;
    }).n;
    const beforeEvents = (db1.prepare("SELECT COUNT(*) as n FROM agent_events").get() as {
      n: number;
    }).n;
    db1.close();

    expect(beforeAgents).toBe(firstAgents);

    const second = await migrateV2ToV3({ arcDir: tmpDir });
    expect(second.alreadyMigrated).toBe(true);
    expect(second.agents).toBe(0);
    expect(second.events).toBe(0);

    const db2 = openDb(dbPath);
    const afterAgents = (db2.prepare("SELECT COUNT(*) as n FROM agents").get() as {
      n: number;
    }).n;
    const afterEvents = (db2.prepare("SELECT COUNT(*) as n FROM agent_events").get() as {
      n: number;
    }).n;
    db2.close();

    expect(afterAgents).toBe(beforeAgents);
    expect(afterEvents).toBe(beforeEvents);
  });

  it("does not write the db file in --dry-run mode", async () => {
    seedV2State(tmpDir);

    const report = await migrateV2ToV3({ arcDir: tmpDir, dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.alreadyMigrated).toBe(false);
    expect(report.agents).toBe(3);
    expect(report.events).toBeGreaterThanOrEqual(4);

    const dbPath = path.join(tmpDir, "arc.db");
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("does not delete or modify v2 source files", async () => {
    seedV2State(tmpDir);
    const histPath = path.join(tmpDir, "history.json");
    const histBefore = fs.readFileSync(histPath, "utf-8");
    const sessPath = path.join(tmpDir, "profiles", "claude", "chat-sessions", "sess-001.json");
    const sessBefore = fs.readFileSync(sessPath, "utf-8");
    const actPath = path.join(tmpDir, "activity.log");
    const actBefore = fs.readFileSync(actPath, "utf-8");

    await migrateV2ToV3({ arcDir: tmpDir });

    expect(fs.readFileSync(histPath, "utf-8")).toBe(histBefore);
    expect(fs.readFileSync(sessPath, "utf-8")).toBe(sessBefore);
    expect(fs.readFileSync(actPath, "utf-8")).toBe(actBefore);
  });

  it("handles a missing history.json gracefully", async () => {
    const report = await migrateV2ToV3({ arcDir: tmpDir });
    expect(report.agents).toBe(0);
    expect(report.errors.length).toBe(0);
  });
});
