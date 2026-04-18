import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChatSession } from "../../../packages/core/src/chat/session.js";
import {
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  getChatSessionsDir,
  getChatSessionPath,
} from "../../../packages/core/src/chat/store.js";

let tmpDir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-chat-store-"));
  prevEnv = process.env["ARC_DIR"];
  process.env["ARC_DIR"] = tmpDir;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env["ARC_DIR"];
  else process.env["ARC_DIR"] = prevEnv;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("chat store", () => {
  it("getChatSessionsDir is under ARC_DIR/profiles/<name>", () => {
    const dir = getChatSessionsDir("work");
    expect(dir).toBe(path.join(tmpDir, "profiles", "work", "chat-sessions"));
  });

  it("rejects invalid session ids in path helper", () => {
    expect(() => getChatSessionPath("work", "../escape")).toThrow(/Invalid chat session id/);
    expect(() => getChatSessionPath("work", "x/y")).toThrow(/Invalid chat session id/);
  });

  it("saves and loads a session round-trip", () => {
    const s = new ChatSession({ profileName: "work", permissionMode: "supervised" });
    s.append({ role: "user", content: "hello" });
    s.append({ role: "assistant", content: "hi" });

    saveSession(s);

    const filePath = getChatSessionPath("work", s.id);
    expect(fs.existsSync(filePath)).toBe(true);

    const loaded = loadSession("work", s.id);
    expect(loaded.id).toBe(s.id);
    expect(loaded.profileName).toBe("work");
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0].role).toBe("user");
  });

  it("listSessions returns empty when dir doesn't exist", () => {
    expect(listSessions("nope")).toEqual([]);
  });

  it("listSessions returns summaries sorted by updatedAt desc", async () => {
    const s1 = new ChatSession({ profileName: "work", permissionMode: "supervised" });
    s1.append({ role: "user", content: "first" });
    saveSession(s1);

    await new Promise((r) => setTimeout(r, 10));

    const s2 = new ChatSession({ profileName: "work", permissionMode: "supervised" });
    s2.append({ role: "user", content: "second" });
    saveSession(s2);

    const list = listSessions("work");
    expect(list.length).toBe(2);
    expect(list[0].id).toBe(s2.id);
    expect(list[1].id).toBe(s1.id);
    expect(list[0].summary).toBe("second");
    expect(list[0].messageCount).toBe(1);
  });

  it("listSessions skips malformed files", () => {
    const dir = getChatSessionsDir("work");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "broken.json"), "not valid json", "utf-8");
    const s = new ChatSession({ profileName: "work", permissionMode: "supervised" });
    s.append({ role: "user", content: "ok" });
    saveSession(s);
    const list = listSessions("work");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(s.id);
  });

  it("deleteSession removes file; no-op if missing", () => {
    const s = new ChatSession({ profileName: "work", permissionMode: "supervised" });
    s.append({ role: "user", content: "hi" });
    saveSession(s);
    const p = getChatSessionPath("work", s.id);
    expect(fs.existsSync(p)).toBe(true);
    deleteSession("work", s.id);
    expect(fs.existsSync(p)).toBe(false);
    // no-op second time
    expect(() => deleteSession("work", s.id)).not.toThrow();
  });

  it("loadSession throws for missing files", () => {
    expect(() => loadSession("work", "00000000-0000-0000-0000-000000000000")).toThrow(
      /not found/,
    );
  });

  it("loadSession throws for malformed JSON", () => {
    const dir = getChatSessionsDir("work");
    fs.mkdirSync(dir, { recursive: true });
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    fs.writeFileSync(path.join(dir, `${id}.json`), "{not json", "utf-8");
    expect(() => loadSession("work", id)).toThrow(/malformed/);
  });
});
