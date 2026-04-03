// ---------------------------------------------------------------------------
// Phase 18 — Session Continuity
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getArcDir } from "./paths.js";
import { writeLogEvent } from "./logging.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionStatus = "active" | "suspended" | "completed";

export interface SessionThread {
  id: string;
  name: string;
  profile: string;
  adapter: string;
  status: SessionStatus;
  created: string;
  lastActive: string;
  transcript?: string; // path to transcript file
  metadata?: Record<string, unknown>;
}

export interface SessionFilter {
  profile?: string;
  adapter?: string;
  status?: SessionStatus;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sessionsPath(): string {
  return path.join(getArcDir(), "sessions.json");
}

function readSessions(): SessionThread[] {
  try {
    const raw = fs.readFileSync(sessionsPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionThread[]) : [];
  } catch {
    return [];
  }
}

function writeSessions(sessions: SessionThread[]): void {
  const dir = getArcDir();
  fs.mkdirSync(dir, { recursive: true });

  const tempPath = path.join(dir, `sessions.tmp.${crypto.randomBytes(4).toString("hex")}`);
  fs.writeFileSync(tempPath, JSON.stringify(sessions, null, 2) + "\n", "utf-8");
  fs.renameSync(tempPath, sessionsPath());
}

// ---------------------------------------------------------------------------
// Resume-intent heuristic
// ---------------------------------------------------------------------------

const RESUME_PATTERNS = [
  /\bcontinue\b/i,
  /\bkeep going\b/i,
  /\bresume\b/i,
  /\bpick up where\b/i,
  /\bwhere (?:we|i) left off\b/i,
  /\bcarry on\b/i,
];

/**
 * Heuristic: returns true if the input looks like the user wants to resume
 * a suspended session.
 */
export function isResumeIntent(input: string): boolean {
  return RESUME_PATTERNS.some((pattern) => pattern.test(input));
}

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

export class SessionStore {
  /** Create a new session thread, persisted immediately. */
  create(name: string, profile: string, adapter: string): SessionThread {
    const now = new Date().toISOString();
    const session: SessionThread = {
      id: crypto.randomUUID(),
      name,
      profile,
      adapter,
      status: "active",
      created: now,
      lastActive: now,
    };

    const sessions = readSessions();
    sessions.push(session);
    writeSessions(sessions);

    writeLogEvent({
      level: "info",
      component: "session",
      action: "create",
      message: `Session '${name}' created`,
      profile,
      data: { sessionId: session.id, adapter },
    });

    return session;
  }

  /** Retrieve a session by ID. */
  get(id: string): SessionThread | undefined {
    return readSessions().find((s) => s.id === id);
  }

  /** List sessions, optionally filtered. */
  list(filter?: SessionFilter): SessionThread[] {
    let sessions = readSessions();

    if (filter?.profile) {
      sessions = sessions.filter((s) => s.profile === filter.profile);
    }
    if (filter?.adapter) {
      sessions = sessions.filter((s) => s.adapter === filter.adapter);
    }
    if (filter?.status) {
      sessions = sessions.filter((s) => s.status === filter.status);
    }

    return sessions;
  }

  /** Update arbitrary fields on a session. */
  update(id: string, fields: Partial<Omit<SessionThread, "id">>): SessionThread {
    const sessions = readSessions();
    const session = sessions.find((s) => s.id === id);
    if (!session) {
      throw new Error(`Session '${id}' not found`);
    }

    Object.assign(session, fields, { lastActive: new Date().toISOString() });
    writeSessions(sessions);

    return session;
  }

  /** Mark a session as suspended. */
  suspend(id: string): SessionThread {
    return this.update(id, { status: "suspended" });
  }

  /** Resume a suspended session, marking it as active. */
  resume(id: string): SessionThread {
    const session = this.get(id);
    if (session && session.status !== "suspended") {
      throw new Error(`Session '${id}' is not suspended (current: ${session.status})`);
    }

    const updated = this.update(id, { status: "active" });

    writeLogEvent({
      level: "info",
      component: "session",
      action: "resume",
      message: `Session '${updated.name}' resumed`,
      profile: updated.profile,
      data: { sessionId: id },
    });

    return updated;
  }

  /** Mark a session as completed. */
  complete(id: string): SessionThread {
    return this.update(id, { status: "completed" });
  }

  /** Return all sessions with status 'active'. */
  getActive(): SessionThread[] {
    return readSessions().filter((s) => s.status === "active");
  }

  /**
   * Return the most recently active suspended session, or null if none
   * exist.
   */
  getLastSuspended(): SessionThread | null {
    const suspended = readSessions()
      .filter((s) => s.status === "suspended")
      .sort((a, b) => b.lastActive.localeCompare(a.lastActive));

    return suspended[0] ?? null;
  }
}
