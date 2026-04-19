import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Mock `@axiom-labs/arc-core` — we override `getAgentClientForProfile` to
// return a stub client that yields a scripted AgentChunk stream. Everything
// else (ChatSession, ToolRegistry, runAgent, buildSystemPrompt, config
// helpers) comes from the real core module.
//
// writeLogEvent is stubbed so store ops don't race on an empty logs dir.
// ---------------------------------------------------------------------------

vi.mock("@axiom-labs/arc-core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    writeLogEvent: vi.fn(),
    getAgentClientForProfile: vi.fn(),
  };
});

import {
  getAgentClientForProfile,
  loadSession,
  listSessions,
  type AgentChunk,
  type AgentClient,
} from "@axiom-labs/arc-core";
import type { ArcConfig } from "../../packages/core/src/types.js";
import { handleChat } from "../../packages/cli/src/commands/chat.js";

// ---------------------------------------------------------------------------
// Per-test filesystem isolation
// ---------------------------------------------------------------------------

let arcDir: string;
let prevArcDir: string | undefined;
const profileName = "test-profile";

function writeConfig(cfg: ArcConfig): void {
  fs.mkdirSync(arcDir, { recursive: true });
  fs.writeFileSync(path.join(arcDir, "config.json"), JSON.stringify(cfg, null, 2), "utf-8");
}

function scriptedClient(chunks: AgentChunk[]): AgentClient {
  const sendFn = vi.fn(async function* (_prompt: string) {
    for (const c of chunks) yield c;
  });
  return {
    send: sendFn as unknown as AgentClient["send"],
    shutdown: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  arcDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-chat-cli-test-"));
  prevArcDir = process.env["ARC_DIR"];
  process.env["ARC_DIR"] = arcDir;
  fs.mkdirSync(path.join(arcDir, "profiles", profileName), { recursive: true });
  fs.mkdirSync(path.join(arcDir, "logs"), { recursive: true });
  writeConfig({
    version: 1,
    activeProfile: profileName,
    profiles: {
      [profileName]: {
        authType: "oauth",
        tool: "claude",
        configDir: path.join(arcDir, "profiles", profileName),
        createdAt: "2026-01-01T00:00:00Z",
      },
    },
  });
  vi.mocked(getAgentClientForProfile).mockReset();
});

afterEach(() => {
  if (prevArcDir === undefined) delete process.env["ARC_DIR"];
  else process.env["ARC_DIR"] = prevArcDir;
  try {
    fs.rmSync(arcDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("arc chat --once (one-shot)", () => {
  it("streams text and terminates on done, persisting the session", async () => {
    const client = scriptedClient([
      { type: "text", content: "Hello" },
      { type: "text", content: " world." },
      { type: "done", reason: "end_turn" },
    ]);
    vi.mocked(getAgentClientForProfile).mockReturnValue(client);

    // Capture stdout.
    const writes: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as typeof process.stdout.write;

    try {
      await handleChat({ once: "hi", mode: "supervised" });
    } finally {
      process.stdout.write = origWrite;
    }

    const out = writes.join("");
    expect(out).toContain("Hello");
    expect(out).toContain("world.");

    const sessions = listSessions(profileName);
    expect(sessions.length).toBe(1);

    const session = loadSession(profileName, sessions[0].id);
    // system seed + user + assistant
    expect(session.messages.length).toBe(3);
    const roles = session.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant"]);
    expect(session.messages[1].content).toBe("hi");
    expect(session.messages[2].content).toContain("Hello world.");
  });

  it("dispatches a list_profiles tool_call, executes it, streams the result, and records it on the assistant message", async () => {
    const client = scriptedClient([
      { type: "text", content: "Looking up profiles..." },
      {
        type: "tool_call",
        id: "tc-1",
        tool: "list_profiles",
        input: {},
      },
      { type: "done", reason: "end_turn" },
    ]);
    vi.mocked(getAgentClientForProfile).mockReturnValue(client);

    const writes: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as typeof process.stdout.write;

    try {
      // autonomous so the read-only `list_profiles` tool doesn't need confirmation
      // (it's a read tool so it wouldn't anyway, but this makes intent explicit)
      await handleChat({ once: "list my profiles", mode: "autonomous" });
    } finally {
      process.stdout.write = origWrite;
    }

    const out = writes.join("");
    expect(out).toContain("tool:list_profiles");
    expect(out).toContain("result");
    // list_profiles serialises the profile into its output; our profile name should appear
    expect(out).toContain(profileName);

    const sessions = listSessions(profileName);
    expect(sessions.length).toBe(1);

    const session = loadSession(profileName, sessions[0].id);
    const assistant = session.messages.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant?.toolCalls).toBeDefined();
    expect(assistant?.toolCalls?.[0]?.name).toBe("list_profiles");
    expect(assistant?.toolCalls?.[0]?.id).toBe("tc-1");
    expect(assistant?.toolCalls?.[0]?.result).toBeDefined();
  });
});
