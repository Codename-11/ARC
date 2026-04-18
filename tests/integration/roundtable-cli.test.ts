/**
 * Integration tests for `arc roundtable` CLI — Phase 6.
 *
 * We inject a stub orchestrator via `deps.orchestratorFactory` so the CLI
 * logic (flag parsing, profile loading, streaming formatter, JSON output)
 * is exercised without spawning real agent binaries.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ArcConfig } from "../../packages/core/src/types.js";
import type {
  RoundtableEvent,
  RoundtableResult,
  RoundtableRunOptions,
} from "../../packages/core/src/orchestration/roundtable.js";
import { handleRoundtable } from "../../packages/cli/src/commands/roundtable.js";

// ---------------------------------------------------------------------------
// Filesystem isolation
// ---------------------------------------------------------------------------

let arcDir: string;
let prevArcDir: string | undefined;

function writeConfig(cfg: ArcConfig): void {
  fs.mkdirSync(arcDir, { recursive: true });
  fs.writeFileSync(path.join(arcDir, "config.json"), JSON.stringify(cfg, null, 2), "utf-8");
}

function profile(name: string, tool: string) {
  const dir = path.join(arcDir, "profiles", name);
  fs.mkdirSync(dir, { recursive: true });
  return {
    authType: "oauth" as const,
    tool,
    configDir: dir,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

beforeEach(() => {
  arcDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-rt-cli-test-"));
  prevArcDir = process.env["ARC_DIR"];
  process.env["ARC_DIR"] = arcDir;
  fs.mkdirSync(path.join(arcDir, "logs"), { recursive: true });
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
// Stub orchestrator
// ---------------------------------------------------------------------------

function stubResult(): RoundtableResult {
  return {
    transcript: [
      {
        agent: "alice",
        role: "advocate",
        round: 1,
        content: "go for it",
        createdAt: Date.now(),
        latencyMs: 10,
      },
      {
        agent: "bob",
        role: "critic",
        round: 1,
        content: "not so fast",
        createdAt: Date.now(),
        latencyMs: 10,
      },
    ],
    synthesis: "split decision",
    consensusScore: 0.5,
    keyPoints: ["alpha", "beta"],
    durationMs: 123,
    roundtableId: "rt-fake-1",
  };
}

function makeStubFactory(
  scriptedEvents: RoundtableEvent[],
  result: RoundtableResult = stubResult(),
): {
  factory: () => { run: (opts: RoundtableRunOptions) => Promise<RoundtableResult> };
  capturedOpts: RoundtableRunOptions[];
} {
  const capturedOpts: RoundtableRunOptions[] = [];
  const factory = () => ({
    async run(opts: RoundtableRunOptions): Promise<RoundtableResult> {
      capturedOpts.push(opts);
      for (const evt of scriptedEvents) {
        opts.onEvent?.(evt);
      }
      return result;
    },
  });
  return { factory: factory as never, capturedOpts };
}

function captureStdout(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  return {
    writes,
    restore: () => {
      process.stdout.write = origOut;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("arc roundtable CLI", () => {
  it("streams turn-start + turn-chunk + synthesis in plain format", async () => {
    writeConfig({
      version: 1,
      activeProfile: "alice",
      profiles: {
        alice: profile("alice", "claude"),
        bob: profile("bob", "codex"),
      },
    });

    const events: RoundtableEvent[] = [
      { type: "turn-start", agent: "alice", role: "advocate", round: 1, turnIndex: 0 },
      { type: "turn-chunk", agent: "alice", chunk: { type: "text", content: "go for it" } },
      { type: "turn-complete", agent: "alice", round: 1, latencyMs: 10, content: "go for it" },
      { type: "turn-start", agent: "bob", role: "critic", round: 1, turnIndex: 1 },
      { type: "turn-chunk", agent: "bob", chunk: { type: "text", content: "not so fast" } },
      { type: "turn-complete", agent: "bob", round: 1, latencyMs: 10, content: "not so fast" },
      { type: "synthesis-start", agent: "alice" },
      {
        type: "synthesis-complete",
        consensusScore: 0.5,
        summary: "split decision",
      },
    ];
    const { factory, capturedOpts } = makeStubFactory(events);

    const { writes, restore } = captureStdout();
    try {
      await handleRoundtable(
        "should we ship?",
        { agents: "alice,bob", rounds: "2", format: "plain", pacing: false },
        { orchestratorFactory: factory as never },
      );
    } finally {
      restore();
    }

    const out = writes.join("");
    expect(out).toContain("[alice]");
    expect(out).toContain("[advocate]");
    expect(out).toContain("go for it");
    expect(out).toContain("[bob]");
    expect(out).toContain("[critic]");
    expect(out).toContain("not so fast");
    expect(out).toContain("Synthesis");
    expect(out).toContain("split decision");
    // Final summary block
    expect(out).toContain("Consensus: 0.50");
    expect(out).toContain("Key points:");
    expect(out).toContain("alpha");

    // Orchestrator received correct agents
    expect(capturedOpts.length).toBe(1);
    const opts = capturedOpts[0];
    expect(opts.topic).toBe("should we ship?");
    expect(opts.agents.length).toBe(2);
    expect(opts.agents[0].displayName).toBe("alice");
    expect(opts.agents[0].role).toBe("advocate");
    expect(opts.agents[1].displayName).toBe("bob");
    expect(opts.agents[1].role).toBe("critic");
    expect(opts.rounds).toBe(2);
  });

  it("prints JSON and suppresses streaming when --format json", async () => {
    writeConfig({
      version: 1,
      activeProfile: "a",
      profiles: {
        a: profile("a", "claude"),
        b: profile("b", "codex"),
      },
    });

    const { factory } = makeStubFactory([
      { type: "turn-start", agent: "a", role: "advocate", round: 1, turnIndex: 0 },
      { type: "turn-chunk", agent: "a", chunk: { type: "text", content: "HELLO" } },
    ]);

    const { writes, restore } = captureStdout();
    try {
      await handleRoundtable(
        "topic",
        { agents: "a,b", format: "json", pacing: false },
        { orchestratorFactory: factory as never },
      );
    } finally {
      restore();
    }

    const out = writes.join("");
    // Streaming output should NOT appear
    expect(out).not.toContain("HELLO");
    expect(out).not.toContain("Synthesis");
    // JSON should be parseable
    const parsed = JSON.parse(out.trim());
    expect(parsed.roundtableId).toBe("rt-fake-1");
    expect(parsed.consensusScore).toBe(0.5);
    expect(parsed.transcript.length).toBe(2);
  });

  it("respects --roles when provided", async () => {
    writeConfig({
      version: 1,
      activeProfile: "a",
      profiles: {
        a: profile("a", "claude"),
        b: profile("b", "codex"),
        c: profile("c", "gemini"),
      },
    });

    const { factory, capturedOpts } = makeStubFactory([]);

    const { restore } = captureStdout();
    try {
      await handleRoundtable(
        "topic",
        {
          agents: "a,b,c",
          roles: "neutral,advocate,critic",
          pacing: false,
        },
        { orchestratorFactory: factory as never },
      );
    } finally {
      restore();
    }

    const opts = capturedOpts[0];
    expect(opts.agents.map((a) => a.role)).toEqual([
      "neutral",
      "advocate",
      "critic",
    ]);
  });

  it("exits with error when a profile is missing", async () => {
    writeConfig({
      version: 1,
      activeProfile: "a",
      profiles: {
        a: profile("a", "claude"),
      },
    });

    const errors: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string | Uint8Array) => {
      errors.push(typeof c === "string" ? c : c.toString());
      return true;
    }) as typeof process.stderr.write;

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code ?? 0}`);
      }) as never);

    try {
      await expect(
        handleRoundtable(
          "topic",
          { agents: "a,does-not-exist" },
          { orchestratorFactory: (() => ({ run: async () => stubResult() })) as never },
        ),
      ).rejects.toThrow(/exit:1/);
    } finally {
      process.stderr.write = origStderr;
      exitSpy.mockRestore();
    }
    const errOut = errors.join("");
    expect(errOut).toMatch(/does-not-exist/);
  });

  it("rejects fewer than 2 agents", async () => {
    writeConfig({
      version: 1,
      activeProfile: "a",
      profiles: { a: profile("a", "claude") },
    });
    const errors: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string | Uint8Array) => {
      errors.push(typeof c === "string" ? c : c.toString());
      return true;
    }) as typeof process.stderr.write;
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code ?? 0}`);
      }) as never);
    try {
      await expect(
        handleRoundtable(
          "topic",
          { agents: "a" },
          { orchestratorFactory: (() => ({ run: async () => stubResult() })) as never },
        ),
      ).rejects.toThrow(/exit:1/);
    } finally {
      process.stderr.write = origStderr;
      exitSpy.mockRestore();
    }
    expect(errors.join("")).toMatch(/at least 2/);
  });
});
