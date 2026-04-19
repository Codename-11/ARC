/**
 * Integration test for the `arc_chat` MCP tool — Phase 6.
 *
 * Mocks `getAgentClientForProfile` to return a scripted AgentClient so the
 * tool wiring (profile resolution, registry, runAgent, text collection) is
 * exercised without spawning a real CLI.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@axiom-labs/arc-core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    writeLogEvent: vi.fn(),
    getAgentClientForProfile: vi.fn(),
  };
});

import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import {
  getAgentClientForProfile,
  type AgentChunk,
  type AgentClient,
} from "@axiom-labs/arc-core";
import type { ArcConfig } from "../../packages/core/src/types.js";
import { createArcMcpServer } from "@axiom-labs/arc-mcp";

// ---------------------------------------------------------------------------
// FS isolation
// ---------------------------------------------------------------------------

let arcDir: string;
let prevArcDir: string | undefined;
const profileName = "chat-mcp-test";

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

async function connect() {
  const server = createArcMcpServer();
  const client = new Client({ name: "t", version: "0.0.1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  return {
    client,
    cleanup: async () => {
      await ct.close();
      await st.close();
    },
  };
}

beforeEach(() => {
  arcDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-chat-mcp-test-"));
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

describe("MCP arc_chat tool", () => {
  it("returns joined text from the agent", async () => {
    vi.mocked(getAgentClientForProfile).mockReturnValue(
      scriptedClient([
        { type: "text", content: "Hello" },
        { type: "text", content: " there." },
        { type: "done", reason: "end_turn" },
      ]),
    );

    const { client, cleanup } = await connect();
    try {
      const res = await client.callTool({
        name: "arc_chat",
        arguments: { prompt: "hi" },
      });
      const content = (res as { content: { type: string; text: string }[] })
        .content;
      expect(content[0].text).toBe("Hello there.");
    } finally {
      await cleanup();
    }
  });

  it("returns an error content block when profile is missing", async () => {
    const { client, cleanup } = await connect();
    try {
      const res = await client.callTool({
        name: "arc_chat",
        arguments: { prompt: "hi", profile: "no-such-profile" },
      });
      expect((res as { isError?: boolean }).isError).toBe(true);
      const content = (res as { content: { type: string; text: string }[] })
        .content;
      expect(content[0].text).toMatch(/no-such-profile/);
    } finally {
      await cleanup();
    }
  });

  it("warns on autonomous mode via stderr", async () => {
    vi.mocked(getAgentClientForProfile).mockReturnValue(
      scriptedClient([
        { type: "text", content: "ok" },
        { type: "done", reason: "end_turn" },
      ]),
    );

    const stderrChunks: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string | Uint8Array) => {
      stderrChunks.push(typeof c === "string" ? c : c.toString());
      return true;
    }) as typeof process.stderr.write;

    const { client, cleanup } = await connect();
    try {
      await client.callTool({
        name: "arc_chat",
        arguments: { prompt: "hi", mode: "autonomous" },
      });
    } finally {
      process.stderr.write = origStderr;
      await cleanup();
    }
    expect(stderrChunks.join("")).toMatch(/autonomous/i);
  });
});
