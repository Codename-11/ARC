import { describe, it, expect } from "vitest";
import {
  DEFAULT_COMPLETION_PATTERNS,
  InMemoryMessageBus,
  StagedWorkflowManager,
  type StagedMessage,
  type StagedPhase,
} from "../../../packages/core/src/orchestration/staged-workflow.js";

function msg(from: string, content: string, createdAt = 0): StagedMessage {
  return { id: `${from}-${createdAt}-${Math.random()}`, from, content, createdAt };
}

describe("DEFAULT_COMPLETION_PATTERNS", () => {
  it("matches PLAN_SHARED keywords", () => {
    const p = DEFAULT_COMPLETION_PATTERNS.plan;
    expect(p.some((r) => r.test("plan shared with team"))).toBe(true);
    expect(p.some((r) => r.test("here is my approach"))).toBe(true);
    expect(p.some((r) => r.test("ready"))).toBe(true);
  });

  it("matches EXEC_DONE keywords", () => {
    const p = DEFAULT_COMPLETION_PATTERNS.exec;
    expect(p.some((r) => r.test("implementation done"))).toBe(true);
    expect(p.some((r) => r.test("finished the refactor"))).toBe(true);
    expect(p.some((r) => r.test("implemented"))).toBe(true);
  });

  it("matches VERIFY_OK keywords", () => {
    const p = DEFAULT_COMPLETION_PATTERNS.verify;
    expect(p.some((r) => r.test("verify_ok"))).toBe(true);
    expect(p.some((r) => r.test("review complete"))).toBe(true);
    expect(p.some((r) => r.test("approved"))).toBe(true);
  });
});

describe("StagedWorkflowManager", () => {
  it("progresses through all phases when every agent matches", async () => {
    const bus = new InMemoryMessageBus();
    const phases: StagedPhase[] = ["plan", "exec", "verify"];
    const agents = ["alice", "bob"];

    // Pre-populate every phase's completion messages. Because resetCursor
    // rewinds the cursor on phase entry, the manager re-reads the full bus
    // each phase — messages that match all three phase patterns will let
    // the workflow advance straight through.
    for (const p of phases) {
      await bus.post(msg("alice", `${p} ready — plan shared done approved`));
      await bus.post(msg("bob", `${p} ready — plan shared done approved`));
    }

    const observed: Array<string> = [];
    const manager = new StagedWorkflowManager(
      {
        phases,
        phaseTimeoutMs: { plan: 10_000, exec: 10_000, verify: 10_000 },
        pollIntervalMs: 1,
        onPhaseChange: (p) => observed.push(p),
      },
      { messageBus: bus, allAgents: agents },
    );

    const result = await manager.run();
    expect(result.phase).toBe("complete");
    expect(result.phasesCompleted).toEqual(phases);
    expect(result.phasesTimedOut).toEqual([]);
    expect(observed).toContain("plan");
    expect(observed).toContain("exec");
    expect(observed).toContain("verify");
    expect(observed).toContain("complete");
  });

  it("records a timeout when agents never match the completion pattern", async () => {
    const bus = new InMemoryMessageBus();
    const manager = new StagedWorkflowManager(
      {
        phases: ["plan"],
        phaseTimeoutMs: { plan: 20, exec: 20, verify: 20 },
        pollIntervalMs: 1,
      },
      { messageBus: bus, allAgents: ["alice", "bob"] },
    );

    // Post a non-matching message.
    await bus.post(msg("alice", "still thinking"));

    const result = await manager.run();
    expect(result.phasesCompleted).toEqual([]);
    expect(result.phasesTimedOut).toEqual(["plan"]);
    expect(result.phase).toBe("complete"); // terminal regardless of timeout
  });

  it("holds the phase when only some agents match", async () => {
    const bus = new InMemoryMessageBus();
    const manager = new StagedWorkflowManager(
      {
        phases: ["plan"],
        phaseTimeoutMs: { plan: 30, exec: 30, verify: 30 },
        pollIntervalMs: 1,
      },
      { messageBus: bus, allAgents: ["alice", "bob"] },
    );

    await bus.post(msg("alice", "plan shared ready"));
    // Never post bob's completion.

    const result = await manager.run();
    expect(result.phasesTimedOut).toEqual(["plan"]);
  });
});
