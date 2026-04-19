/**
 * Per-profile chat session store.
 *
 * Sessions live under `<profileDir>/chat-sessions/<sessionId>.json`. We create
 * the directory lazily on first save and use an atomic `write → rename` to
 * avoid torn files on crash.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getProfileDir } from "../paths.js";
import {
  ChatSession,
  type ChatSessionJson,
  type ChatSessionSummary,
} from "./session.js";

/** Directory holding all chat sessions for a profile. */
export function getChatSessionsDir(profileName: string): string {
  return path.join(getProfileDir(profileName), "chat-sessions");
}

/** Full path to one chat session file. */
export function getChatSessionPath(profileName: string, sessionId: string): string {
  // Defensive: block path-traversal via malformed sessionId.
  if (!/^[A-Za-z0-9_.-]+$/.test(sessionId)) {
    throw new Error(`Invalid chat session id: "${sessionId}"`);
  }
  return path.join(getChatSessionsDir(profileName), `${sessionId}.json`);
}

function atomicWrite(target: string, contents: string): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(target)}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  );
  fs.writeFileSync(tmp, contents, "utf-8");
  fs.renameSync(tmp, target);
}

/**
 * Persist a `ChatSession` to disk under its profile's directory.
 * Creates `chat-sessions/` lazily. Atomic via temp-file + rename.
 */
export function saveSession(session: ChatSession): void {
  const target = getChatSessionPath(session.profileName, session.id);
  const json = session.serialize();
  atomicWrite(target, JSON.stringify(json, null, 2));
}

/**
 * Load a `ChatSession` by id from a profile's sessions dir. Throws if the
 * file is missing or malformed.
 */
export function loadSession(profileName: string, id: string): ChatSession {
  const p = getChatSessionPath(profileName, id);
  if (!fs.existsSync(p)) {
    throw new Error(`Chat session not found: ${profileName}/${id}`);
  }
  const raw = fs.readFileSync(p, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Chat session JSON is malformed (${profileName}/${id}): ${msg}`);
  }
  return ChatSession.load(parsed);
}

/**
 * List all saved sessions for a profile, sorted by `updatedAt` descending.
 * Returns summaries (no full message bodies) for display.
 */
export function listSessions(profileName: string): ChatSessionSummary[] {
  const dir = getChatSessionsDir(profileName);
  if (!fs.existsSync(dir)) return [];

  const out: ChatSessionSummary[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const full = path.join(dir, entry);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, "utf-8")) as ChatSessionJson;
      const session = ChatSession.load(parsed);
      out.push({
        id: session.id,
        summary: session.summary(),
        profileName: session.profileName,
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
        messageCount: session.messages.length,
      });
    } catch {
      // Skip unreadable files rather than erroring the whole listing.
      continue;
    }
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
}

/** Delete a saved session. No-op if the file does not exist. */
export function deleteSession(profileName: string, id: string): void {
  const p = getChatSessionPath(profileName, id);
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}
