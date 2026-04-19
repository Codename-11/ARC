/**
 * v2 → v3 migration — ingest legacy ARC state into the v3 SQLite store.
 *
 * Sources:
 *   - ~/.arc/history.json                       (launch history)
 *   - ~/.arc/profiles/<name>/chat-sessions/*.json  (chat transcripts)
 *   - ~/.arc/activity.log OR ~/.arc/logs/events.ndjson  (JSONL activity)
 *
 * Targets:
 *   - agents         (one row per history entry)
 *   - agent_events   (chat turns, tool_call/tool_result, activity status)
 *   - meta           ("migration_v2_to_v3_completed_at" idempotence marker)
 *
 * Invariants:
 *   - Idempotent: if the meta marker is present, this is a no-op.
 *   - Non-destructive: v2 files are never deleted or modified.
 *   - Dry-run returns counts without opening the database for writes.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openDb } from "../db.js";

export interface MigrationOptions {
  arcDir: string;
  dryRun?: boolean;
  /** Override the db path (defaults to `<arcDir>/arc.db`). */
  dbPath?: string;
}

export interface MigrationReport {
  /** Distinct profile names discovered across inputs. */
  profiles: number;
  /** Rows inserted into `agents`. */
  agents: number;
  /** Rows inserted into `agent_events`. */
  events: number;
  /** Chat assistant/user messages surfaced (subset of `events`). */
  chatMessages: number;
  /** Entries intentionally skipped (already-present marker, malformed rows). */
  skipped: number;
  /** Non-fatal errors encountered during ingestion. */
  errors: string[];
  /**
   * True if migration was short-circuited because the idempotence marker was
   * already set.
   */
  alreadyMigrated: boolean;
  /** True if `dryRun` was requested. */
  dryRun: boolean;
}

const MIGRATION_MARKER_KEY = "migration_v2_to_v3_completed_at";

// Minimal local shape — we intentionally avoid importing from @axiom-labs/arc-core
// here to keep the daemon package free of cross-package cycles.
interface V2HistoryEntry {
  profile: string;
  tool: string;
  timestamp: string | number;
  outcome: string;
  exitCode?: number;
}

interface V2ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    input?: unknown;
    result?: unknown;
    error?: string;
  }>;
  toolCallId?: string;
  timestamp: string;
}

interface V2ChatSession {
  id: string;
  profileName: string;
  messages: V2ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

interface V2ActivityEntry {
  timestamp?: string;
  level?: string;
  component?: string;
  action?: string;
  message?: string;
  detail?: string;
  profile?: string;
  tool?: string;
  data?: Record<string, unknown>;
}

/**
 * Run the v2 → v3 migration.
 *
 * When `dryRun` is true, the database is not opened for writes — counts are
 * computed purely from the filesystem inputs. A marker row is only written on
 * a real run; in dry-run we still detect a pre-existing marker so the caller
 * can reflect "already migrated" without side effects.
 */
export async function migrateV2ToV3(opts: MigrationOptions): Promise<MigrationReport> {
  const arcDir = opts.arcDir;
  const dryRun = opts.dryRun ?? false;
  const dbPath = opts.dbPath ?? path.join(arcDir, "arc.db");

  const report: MigrationReport = {
    profiles: 0,
    agents: 0,
    events: 0,
    chatMessages: 0,
    skipped: 0,
    errors: [],
    alreadyMigrated: false,
    dryRun,
  };

  // Fast-path: if the db already exists and the marker is set, do nothing.
  if (fs.existsSync(dbPath)) {
    try {
      const existing = openDb(dbPath);
      try {
        const row = existing
          .prepare("SELECT value FROM meta WHERE key = ?")
          .get(MIGRATION_MARKER_KEY) as { value: string } | undefined;
        if (row) {
          report.alreadyMigrated = true;
          return report;
        }
      } finally {
        existing.close();
      }
    } catch (err) {
      // If we cannot open or read meta, fall through — the main pass will try
      // again and surface the real error.
      report.errors.push(`pre-check: ${(err as Error).message}`);
    }
  }

  // Collect inputs from disk.
  const historyEntries = readHistory(arcDir, report);
  const chatSessions = readChatSessions(arcDir, report);
  const activityEntries = readActivityLog(arcDir, report);

  const profileSet = new Set<string>();
  for (const h of historyEntries) profileSet.add(h.profile);
  for (const s of chatSessions) profileSet.add(s.profileName);
  for (const a of activityEntries) {
    if (a.profile) profileSet.add(a.profile);
  }
  report.profiles = profileSet.size;

  // Build agent rows from history. Each launch becomes one agent with status
  // `completed`, using a deterministic synthetic id derived from the entry.
  type AgentRow = {
    id: string;
    profile: string;
    cwd: string;
    status: string;
    launch_mode: string;
    created_at: number;
    updated_at: number;
    completed_at: number | null;
    worktree: string | null;
    metadata: string | null;
  };

  const agentRows: AgentRow[] = [];
  for (const entry of historyEntries) {
    const ts = normalizeTimestamp(entry.timestamp);
    if (ts === null) {
      report.skipped++;
      continue;
    }
    const id = deterministicAgentId(entry, ts);
    agentRows.push({
      id,
      profile: entry.profile,
      cwd: "",
      status: "completed",
      launch_mode: "native",
      created_at: ts,
      updated_at: ts,
      completed_at: ts,
      worktree: null,
      metadata: JSON.stringify({
        source: "v2-history",
        tool: entry.tool,
        outcome: entry.outcome,
        ...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}),
      }),
    });
  }

  // Build events for chat sessions. We need a carrier agent per session — if
  // a session cannot be tied to a history launch, synthesize one so FKs hold.
  type EventRow = {
    agent_id: string;
    epoch: number;
    seq: number;
    ts: number;
    kind: string;
    payload: string;
  };
  const eventRows: EventRow[] = [];

  for (const session of chatSessions) {
    const carrier = pickOrSynthesizeAgent(session, agentRows);
    let seq = 0;
    for (const msg of session.messages) {
      const ts = normalizeTimestamp(msg.timestamp) ?? carrier.created_at;
      if (msg.role === "assistant" || msg.role === "user" || msg.role === "system") {
        eventRows.push({
          agent_id: carrier.id,
          epoch: 1,
          seq: ++seq,
          ts,
          kind: "stdout",
          payload: JSON.stringify({ role: msg.role, content: msg.content, sessionId: session.id }),
        });
        report.chatMessages++;
      }
      if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
        for (const call of msg.toolCalls) {
          eventRows.push({
            agent_id: carrier.id,
            epoch: 1,
            seq: ++seq,
            ts,
            kind: "tool_call",
            payload: JSON.stringify({ id: call.id, name: call.name, input: call.input ?? null, sessionId: session.id }),
          });
          if (call.result !== undefined || call.error !== undefined) {
            eventRows.push({
              agent_id: carrier.id,
              epoch: 1,
              seq: ++seq,
              ts,
              kind: "tool_result",
              payload: JSON.stringify({
                id: call.id,
                ...(call.result !== undefined ? { result: call.result } : {}),
                ...(call.error !== undefined ? { error: call.error } : {}),
                sessionId: session.id,
              }),
            });
          }
        }
      }
      if (msg.role === "tool") {
        eventRows.push({
          agent_id: carrier.id,
          epoch: 1,
          seq: ++seq,
          ts,
          kind: "tool_result",
          payload: JSON.stringify({
            toolCallId: msg.toolCallId ?? null,
            content: msg.content,
            sessionId: session.id,
          }),
        });
      }
    }
  }

  // Correlate activity log entries to an agent by timestamp window.
  const activityWindowMs = 10 * 60 * 1000; // 10 minutes either side
  const activitySeqCursor = new Map<string, number>();
  // Seed the cursor with the current max seq per agent so activity events
  // append after chat events rather than rescanning `eventRows` per entry.
  for (const ev of eventRows) {
    const cur = activitySeqCursor.get(ev.agent_id) ?? 0;
    if (ev.seq > cur) activitySeqCursor.set(ev.agent_id, ev.seq);
  }
  for (const entry of activityEntries) {
    const ts = normalizeTimestamp(entry.timestamp ?? Date.now());
    if (ts === null) {
      report.skipped++;
      continue;
    }
    const carrier = findAgentInWindow(agentRows, entry.profile, ts, activityWindowMs);
    if (!carrier) {
      // No carrier — skip rather than create a synthetic agent for every log
      // line, which would explode the dataset.
      report.skipped++;
      continue;
    }
    const next = (activitySeqCursor.get(carrier.id) ?? 0) + 1;
    activitySeqCursor.set(carrier.id, next);
    eventRows.push({
      agent_id: carrier.id,
      epoch: 1,
      seq: next,
      ts,
      kind: "status",
      payload: JSON.stringify({
        source: "v2-activity",
        action: entry.action,
        level: entry.level,
        component: entry.component,
        message: entry.message ?? entry.detail,
        ...(entry.tool ? { tool: entry.tool } : {}),
        ...(entry.data ? { data: entry.data } : {}),
      }),
    });
  }

  report.agents = agentRows.length;
  report.events = eventRows.length;

  if (dryRun) {
    return report;
  }

  // Write phase — one transaction for atomicity.
  const db = openDb(dbPath);
  try {
    // Re-check marker inside the transaction to avoid races with a concurrent
    // migrate invocation on the same dir.
    const existing = db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(MIGRATION_MARKER_KEY) as { value: string } | undefined;
    if (existing) {
      report.alreadyMigrated = true;
      // Reset counts so the caller sees this as a no-op.
      report.agents = 0;
      report.events = 0;
      report.chatMessages = 0;
      return report;
    }

    const insertAgent = db.prepare(
      `INSERT OR IGNORE INTO agents
        (id, profile, cwd, status, launch_mode, created_at, updated_at, completed_at, worktree, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertEvent = db.prepare(
      `INSERT INTO agent_events (agent_id, epoch, seq, ts, kind, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertMeta = db.prepare(
      `INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`,
    );

    const tx = db.transaction(() => {
      for (const row of agentRows) {
        insertAgent.run(
          row.id,
          row.profile,
          row.cwd,
          row.status,
          row.launch_mode,
          row.created_at,
          row.updated_at,
          row.completed_at,
          row.worktree,
          row.metadata,
        );
      }
      for (const ev of eventRows) {
        try {
          insertEvent.run(ev.agent_id, ev.epoch, ev.seq, ev.ts, ev.kind, ev.payload);
        } catch (err) {
          report.errors.push(`event insert: ${(err as Error).message}`);
        }
      }
      insertMeta.run(MIGRATION_MARKER_KEY, new Date().toISOString());
    });
    tx();
  } finally {
    db.close();
  }

  return report;
}

// ---------------------------------------------------------------------------
// Input readers
// ---------------------------------------------------------------------------

function readHistory(arcDir: string, report: MigrationReport): V2HistoryEntry[] {
  const historyPath = path.join(arcDir, "history.json");
  if (!fs.existsSync(historyPath)) return [];
  try {
    const raw = fs.readFileSync(historyPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: V2HistoryEntry[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) {
        report.skipped++;
        continue;
      }
      const r = entry as Record<string, unknown>;
      if (
        typeof r["profile"] !== "string" ||
        typeof r["tool"] !== "string" ||
        (typeof r["timestamp"] !== "string" && typeof r["timestamp"] !== "number") ||
        typeof r["outcome"] !== "string"
      ) {
        report.skipped++;
        continue;
      }
      out.push({
        profile: r["profile"],
        tool: r["tool"],
        timestamp: r["timestamp"] as string | number,
        outcome: r["outcome"],
        exitCode: typeof r["exitCode"] === "number" ? r["exitCode"] : undefined,
      });
    }
    return out;
  } catch (err) {
    report.errors.push(`history.json: ${(err as Error).message}`);
    return [];
  }
}

function readChatSessions(arcDir: string, report: MigrationReport): V2ChatSession[] {
  const profilesDir = path.join(arcDir, "profiles");
  if (!fs.existsSync(profilesDir)) return [];
  const out: V2ChatSession[] = [];
  let profileEntries: string[];
  try {
    profileEntries = fs.readdirSync(profilesDir);
  } catch (err) {
    report.errors.push(`profiles dir: ${(err as Error).message}`);
    return [];
  }
  for (const profile of profileEntries) {
    const sessionsDir = path.join(profilesDir, profile, "chat-sessions");
    if (!fs.existsSync(sessionsDir)) continue;
    let files: string[];
    try {
      files = fs.readdirSync(sessionsDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const full = path.join(sessionsDir, file);
      try {
        const parsed = JSON.parse(fs.readFileSync(full, "utf-8")) as Record<string, unknown>;
        if (
          typeof parsed["id"] !== "string" ||
          typeof parsed["profileName"] !== "string" ||
          !Array.isArray(parsed["messages"])
        ) {
          report.skipped++;
          continue;
        }
        const messages: V2ChatMessage[] = [];
        for (const m of parsed["messages"] as unknown[]) {
          if (typeof m !== "object" || m === null) continue;
          const mm = m as Record<string, unknown>;
          if (
            typeof mm["role"] !== "string" ||
            typeof mm["content"] !== "string" ||
            typeof mm["timestamp"] !== "string"
          ) {
            continue;
          }
          const role = mm["role"] as V2ChatMessage["role"];
          const entry: V2ChatMessage = {
            role,
            content: mm["content"],
            timestamp: mm["timestamp"],
          };
          if (Array.isArray(mm["toolCalls"])) {
            entry.toolCalls = mm["toolCalls"] as V2ChatMessage["toolCalls"];
          }
          if (typeof mm["toolCallId"] === "string") {
            entry.toolCallId = mm["toolCallId"];
          }
          messages.push(entry);
        }
        out.push({
          id: parsed["id"],
          profileName: parsed["profileName"],
          messages,
          createdAt: typeof parsed["createdAt"] === "string" ? parsed["createdAt"] : new Date().toISOString(),
          updatedAt: typeof parsed["updatedAt"] === "string" ? parsed["updatedAt"] : new Date().toISOString(),
        });
      } catch (err) {
        report.errors.push(`chat-session ${file}: ${(err as Error).message}`);
        report.skipped++;
      }
    }
  }
  return out;
}

function readActivityLog(arcDir: string, report: MigrationReport): V2ActivityEntry[] {
  const candidates = [
    path.join(arcDir, "activity.log"),
    path.join(arcDir, "logs", "events.ndjson"),
  ];
  const out: V2ActivityEntry[] = [];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as V2ActivityEntry;
          out.push(parsed);
        } catch {
          report.skipped++;
        }
      }
    } catch (err) {
      report.errors.push(`${path.basename(p)}: ${(err as Error).message}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeTimestamp(ts: unknown): number | null {
  if (typeof ts === "number") {
    if (!Number.isFinite(ts) || ts < 0) return null;
    return Math.floor(ts);
  }
  if (typeof ts === "string") {
    const trimmed = ts.trim();
    if (trimmed.length > 0 && /^\d+$/.test(trimmed)) {
      return Math.floor(Number(trimmed));
    }
    const d = Date.parse(ts);
    if (Number.isNaN(d)) return null;
    return d;
  }
  return null;
}

function deterministicAgentId(entry: V2HistoryEntry, ts: number): string {
  const hash = crypto
    .createHash("sha1")
    .update(`${entry.profile}|${entry.tool}|${ts}|${entry.outcome}|${entry.exitCode ?? ""}`)
    .digest("hex")
    .slice(0, 16);
  return `v2-${hash}`;
}

function pickOrSynthesizeAgent(
  session: V2ChatSession,
  agents: Array<{
    id: string;
    profile: string;
    cwd: string;
    status: string;
    launch_mode: string;
    created_at: number;
    updated_at: number;
    completed_at: number | null;
    worktree: string | null;
    metadata: string | null;
  }>,
): { id: string; profile: string; created_at: number } {
  // Nearest agent for the same profile by createdAt window.
  const created = normalizeTimestamp(session.createdAt) ?? Date.now();
  const candidates = agents.filter((a) => a.profile === session.profileName);
  if (candidates.length > 0) {
    let best = candidates[0]!;
    let bestDelta = Math.abs(best.created_at - created);
    for (const c of candidates) {
      const d = Math.abs(c.created_at - created);
      if (d < bestDelta) {
        best = c;
        bestDelta = d;
      }
    }
    return best;
  }
  // Synthesize a carrier agent for this chat session.
  const synth = {
    id: `v2-chat-${session.id}`,
    profile: session.profileName,
    cwd: "",
    status: "completed",
    launch_mode: "native",
    created_at: created,
    updated_at: normalizeTimestamp(session.updatedAt) ?? created,
    completed_at: normalizeTimestamp(session.updatedAt) ?? created,
    worktree: null,
    metadata: JSON.stringify({ source: "v2-chat-session", sessionId: session.id }),
  };
  agents.push(synth);
  return synth;
}

function findAgentInWindow(
  agents: Array<{ id: string; profile: string; created_at: number }>,
  profile: string | undefined,
  ts: number,
  windowMs: number,
): { id: string; profile: string; created_at: number } | null {
  const scope = profile ? agents.filter((a) => a.profile === profile) : agents;
  let best: { id: string; profile: string; created_at: number } | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const a of scope) {
    const d = Math.abs(a.created_at - ts);
    if (d <= windowMs && d < bestDelta) {
      best = a;
      bestDelta = d;
    }
  }
  return best;
}

