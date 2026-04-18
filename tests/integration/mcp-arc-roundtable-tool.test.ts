/**
 * Integration test for the `arc_roundtable` MCP tool — Phase 6.
 *
 * We stub `RoundtableOrchestrator.run` via prototype monkey-patch so the
 * tool's wiring is exercised without spawning real CLI processes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import {
  RoundtableOrchestrator,
  type RoundtableResult,
  type RoundtableRunOptions,
} from "@axiom-labs/arc-core";
import type { ArcConfig } from "../../packages/core/src/types.js";
import { createArcMcpServer } from "@axiom-labs/arc-mcp";

// ---------------------------------------------------------------------------
// FS isolation
// ---------------------------------------------------------------------------

let arcDir: string;
let prevArcDir: string | undefined;

function writeConfig(cfg: ArcConfig): void {
  fs.mkdirSync(arcDir, { recursive: true });
  fs.writeFileSync(path.join(arcDir, "config.json"), JSON.stringify(cfg, null, 2), "utf-8");
}

function makeProfile(name: string, tool: string) {
  const dir = path.join(arcDir, "profiles", name);
  fs.mkdirSync(dir, { recursive: true });
  return {
    authType: "oauth" as const,
    tool,
    configDir: dir,
    createdAt: "2026-01-01T00:00:00Z",
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

// ---------------------------------------------------------------------------
// Orchestrator stub
// ---------------------------------------------------------------------------

let capturedOpts: RoundtableRunOptions | null = null;
let stubbedResult: RoundtableResult;
let runSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  arcDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-rt-mcp-test-"));
  prevArcDir = process.env["ARC_DIR"];
  process.env["ARC_DIR"] = arcDir;
  fs.mkdirSync(path.join(arcDir, "logs"), { recursive: true });
  writeConfig({
    version: 1,
    activeProfile: "alice",
    profiles: {
      alice: makeProfile("alice", "claude"),
      bob: makeProfile("bob", "codex"),
    },
  });

  capturedOpts = null;
  stubbedResult = {
    transcript: [
      {
        agent: "alice",
        role: "advocate",
        round: 1,
        content: "pro",
        createdAt: Date.now(),
        latencyMs: 5,
      },
    ],
    synthesis: "equal weight",
    consensusScore: 0.42,
    keyPoints: ["kp1"],
    durationMs: 50,
    roundtableId: "rt-stub",
  };

  runSpy = vi
    .spyOn(RoundtableOrchestrator.prototype, "run")
    .mockImplementation(async function (this: RoundtableOrchestrator, opts: RoundtableRunOptions) {
      capturedOpts = opts;
      return stubbedResult;
    });
});

afterEach(() => {
  runSpy?.mockRestore();
  runSpy = null;
  if (prevArcDir === undefined) delete process.env["ARC_DIR"];
  else process.env["ARC_DIR"] = prevArcDir;
  try {
    fs.rmSync(arcDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("MCP arc_roundtable tool", () => {
  it("returns transcript, synthesis, consensusScore, keyPoints", async () => {
    const { client, cleanup } = await connect();
    try {
      const res = await client.callTool({
        name: "arc_roundtable",
        arguments: {
          topic: "ship or not?",
          agents: ["alice", "bob"],
          rounds: 1,
        },
      });
      const content = (res as { content: { type: string; text: string }[] })
        .content;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.synthesis).toBe("equal weight");
      expect(parsed.consensusScore).toBe(0.42);
      expect(parsed.keyPoints).toEqual(["kp1"]);
      expect(parsed.transcript.length).toBe(1);
      expect(parsed.roundtableId).toBe("rt-stub");

      // Verify orchestrator was called with correct agent list + rounds
      expect(capturedOpts).not.toBeNull();
      expect(capturedOpts!.topic).toBe("ship or not?");
      expect(capturedOpts!.rounds).toBe(1);
      expect(capturedOpts!.agents.length).toBe(2);
      expect(capturedOpts!.agents[0].displayName).toBe("alice");
      expect(capturedOpts!.agents[1].displayName).toBe("bob");
    } finally {
      await cleanup();
    }
  });

  it("errors when an agent profile does not exist", async () => {
    const { client, cleanup } = await connect();
    try {
      const res = await client.callTool({
        name: "arc_roundtable",
        arguments: {
          topic: "t",
          agents: ["alice", "ghost"],
        },
      });
      expect((res as { isError?: boolean }).isError).toBe(true);
      const content = (res as { content: { type: string; text: string }[] })
        .content;
      expect(content[0].text).toMatch(/ghost/);
    } finally {
      await cleanup();
    }
  });

  it("errors when synthesizer is not among agents", async () => {
    const { client, cleanup } = await connect();
    try {
      const res = await client.callTool({
        name: "arc_roundtable",
        arguments: {
          topic: "t",
          agents: ["alice", "bob"],
          synthesizer: "stranger",
        },
      });
      expect((res as { isError?: boolean }).isError).toBe(true);
      const content = (res as { content: { type: string; text: string }[] })
        .content;
      expect(content[0].text).toMatch(/stranger/);
    } finally {
      await cleanup();
    }
  });
});
