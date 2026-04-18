import { describe, it, expect } from "vitest";
import type {
  AgentChunk,
  AgentClient,
  AgentSendOptions,
} from "../../../packages/core/src/agent-client/types.js";
import type { Profile } from "../../../packages/core/src/types.js";
import {
  RoundtableOrchestrator,
  type RoundtableAgent,
  type RoundtableEvent,
} from "../../../packages/core/src/orchestration/roundtable.js";

function profile(tool: string, name: string): Profile {
  return {
    authType: "api-key",
    tool,
    configDir: `/tmp/arc-test-${name}`,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Scripted mock AgentClient. `scripts` maps call index → text to emit.
 * Each `send()` yields one text chunk and a `done`.
 */
function makeMockClient(scripts: string[]): AgentClient & { calls: number } {
  let calls = 0;
  const client = {
    async *send(
      _prompt: string,
      _opts?: AgentSendOptions,
    ): AsyncIterable<AgentChunk> {
      const text = scripts[calls] ?? "";
      calls++;
      yield { type: "text", content: text };
      yield { type: "done", reason: "end_turn" };
    },
    async shutdown(): Promise<void> {},
    get calls() {
      return calls;
    },
  } as AgentClient & { calls: number };
  return client;
}

describe("RoundtableOrchestrator", () => {
  it("runs 3 agents × 2 rounds = 6 turns, then synthesis", async () => {
    const clientA = makeMockClient([
      "Alice round 1",
      "Alice round 2",
    ]);
    const clientB = makeMockClient([
      "Bob round 1",
      "Bob round 2",
    ]);
    const clientC = makeMockClient([
      "Carol round 1",
      "Carol round 2",
      JSON.stringify({
        consensus: 0.8,
        summary: "We agreed on A.",
        keyPoints: ["point1", "point2"],
      }),
    ]);

    const agents: RoundtableAgent[] = [
      { role: "advocate", profile: profile("claude", "a"), displayName: "alice" },
      { role: "critic", profile: profile("codex", "b"), displayName: "bob" },
      { role: "neutral", profile: profile("claude", "c"), displayName: "carol" },
    ];

    const clients: Record<string, AgentClient & { calls: number }> = {
      alice: clientA,
      bob: clientB,
      carol: clientC,
    };

    const orchestrator = new RoundtableOrchestrator({
      clientFactory: (p) => {
        // Pick the matching client by configDir suffix.
        if (p.configDir.endsWith("-a")) return clients.alice;
        if (p.configDir.endsWith("-b")) return clients.bob;
        return clients.carol;
      },
      sleep: async () => {}, // skip pacing in tests
    });

    const events: RoundtableEvent[] = [];
    const result = await orchestrator.run({
      topic: "Should we refactor?",
      agents,
      rounds: 2,
      synthesizer: agents[2], // carol
      onEvent: (evt) => events.push(evt),
    });

    // 6 turn-complete events
    const turnCompletes = events.filter((e) => e.type === "turn-complete");
    expect(turnCompletes).toHaveLength(6);

    // Turn order per round
    const turnStarts = events.filter((e) => e.type === "turn-start") as Array<
      Extract<RoundtableEvent, { type: "turn-start" }>
    >;
    expect(turnStarts.map((t) => t.agent)).toEqual([
      "alice",
      "bob",
      "carol",
      "alice",
      "bob",
      "carol",
    ]);

    // Round numbers
    expect(turnStarts.slice(0, 3).every((t) => t.round === 1)).toBe(true);
    expect(turnStarts.slice(3, 6).every((t) => t.round === 2)).toBe(true);

    // Transcript matches
    expect(result.transcript).toHaveLength(6);
    expect(result.transcript[0].content).toBe("Alice round 1");
    expect(result.transcript[5].content).toBe("Carol round 2");

    // Synthesis called on carol (her client saw a third call).
    expect(clientC.calls).toBe(3);
    expect(clientA.calls).toBe(2);
    expect(clientB.calls).toBe(2);

    // Consensus parsed correctly.
    expect(result.consensusScore).toBe(0.8);
    expect(result.synthesis).toBe("We agreed on A.");
    expect(result.keyPoints).toEqual(["point1", "point2"]);

    // Phase-change events observed.
    const phaseChanges = events.filter((e) => e.type === "phase-change");
    expect(phaseChanges.length).toBeGreaterThanOrEqual(2);
    expect(phaseChanges[phaseChanges.length - 1]).toMatchObject({
      status: "complete",
    });

    // Synthesis-complete fires.
    expect(events.some((e) => e.type === "synthesis-complete")).toBe(true);
  });

  it("uses first agent as synthesizer by default", async () => {
    const clientA = makeMockClient([
      "A1",
      "A2",
      JSON.stringify({ consensus: 0.4, summary: "ok", keyPoints: [] }),
    ]);
    const clientB = makeMockClient(["B1", "B2"]);

    const agents: RoundtableAgent[] = [
      { role: "advocate", profile: profile("claude", "a"), displayName: "alice" },
      { role: "critic", profile: profile("codex", "b"), displayName: "bob" },
    ];

    const orchestrator = new RoundtableOrchestrator({
      clientFactory: (p) =>
        p.configDir.endsWith("-a") ? clientA : clientB,
      sleep: async () => {},
    });

    const result = await orchestrator.run({
      topic: "x",
      agents,
      rounds: 2,
      // no synthesizer → defaults to first agent (alice)
    });

    expect(clientA.calls).toBe(3); // 2 rounds + synthesis
    expect(clientB.calls).toBe(2);
    expect(result.consensusScore).toBe(0.4);
  });

  it("returns consensus=0.5 and raw text when synthesizer returns non-JSON", async () => {
    const clientA = makeMockClient([
      "A1",
      "A2",
      "Sorry, I can't produce JSON today.",
    ]);
    const clientB = makeMockClient(["B1", "B2"]);

    const agents: RoundtableAgent[] = [
      { role: "advocate", profile: profile("claude", "a"), displayName: "alice" },
      { role: "critic", profile: profile("codex", "b"), displayName: "bob" },
    ];

    const orchestrator = new RoundtableOrchestrator({
      clientFactory: (p) =>
        p.configDir.endsWith("-a") ? clientA : clientB,
      sleep: async () => {},
    });

    const result = await orchestrator.run({
      topic: "x",
      agents,
      rounds: 2,
    });

    expect(result.consensusScore).toBe(0.5);
    expect(result.synthesis).toBe("Sorry, I can't produce JSON today.");
    expect(result.keyPoints).toEqual([]);
  });

  it("adaptive pacing is observable via the injected sleep", async () => {
    const clientA = makeMockClient([
      "A1",
      "A2",
      JSON.stringify({ consensus: 1, summary: "done", keyPoints: [] }),
    ]);
    const clientB = makeMockClient(["B1", "B2"]);

    const sleeps: number[] = [];
    const orchestrator = new RoundtableOrchestrator({
      clientFactory: (p) =>
        p.configDir.endsWith("-a") ? clientA : clientB,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await orchestrator.run({
      topic: "x",
      agents: [
        { role: "advocate", profile: profile("claude", "a"), displayName: "alice" },
        { role: "critic", profile: profile("codex", "b"), displayName: "bob" },
      ],
      rounds: 2,
    });

    // 4 turns total; sleep only fires *between* turns (3 times).
    expect(sleeps.length).toBe(3);
    // Each sleep should be at least the min reply grace of one policy (8_000
    // for codex, 12_000 for claude) — no zero sleeps.
    expect(sleeps.every((ms) => ms >= 8_000)).toBe(true);
  });

  it("throws when fewer than 2 agents are provided", async () => {
    const orchestrator = new RoundtableOrchestrator({
      clientFactory: () => makeMockClient([]),
      sleep: async () => {},
    });
    await expect(
      orchestrator.run({
        topic: "x",
        agents: [
          {
            role: "advocate",
            profile: profile("claude", "only"),
            displayName: "solo",
          },
        ],
        rounds: 1,
      }),
    ).rejects.toThrow(/at least 2 agents/);
  });

  it("throws when a virtual agent has no profile", async () => {
    const orchestrator = new RoundtableOrchestrator({
      clientFactory: () => makeMockClient([]),
      sleep: async () => {},
    });
    await expect(
      orchestrator.run({
        topic: "x",
        agents: [
          { role: "advocate", profile: profile("claude", "a"), displayName: "alice" },
          { role: "critic", virtualRole: "critic", displayName: "virt" },
        ],
        rounds: 1,
      }),
    ).rejects.toThrow(/Virtual agents not yet supported/);
  });

  it("forces launchMode=worker on agent profiles", async () => {
    const seen: Profile[] = [];
    const clientA = makeMockClient([
      "A1",
      "A2",
      JSON.stringify({ consensus: 0.7, summary: "ok", keyPoints: [] }),
    ]);
    const clientB = makeMockClient(["B1", "B2"]);
    const orchestrator = new RoundtableOrchestrator({
      clientFactory: (p) => {
        seen.push(p);
        return p.configDir.endsWith("-a") ? clientA : clientB;
      },
      sleep: async () => {},
    });

    await orchestrator.run({
      topic: "x",
      agents: [
        {
          role: "advocate",
          profile: { ...profile("claude", "a"), launchMode: "native" },
          displayName: "alice",
        },
        {
          role: "critic",
          profile: { ...profile("codex", "b"), launchMode: "native" },
          displayName: "bob",
        },
      ],
      rounds: 2,
    });

    expect(seen.every((p) => p.launchMode === "worker")).toBe(true);
  });
});
