import { describe, it, expect } from "vitest";
import {
  createRoundtableHook,
  type RoundtableState,
} from "../../../packages/core/src/hooks/roundtable.js";
import { HookStateStore } from "../../../packages/core/src/hooks/hook-state.js";
import type {
  HookContext,
  AgentResponse,
} from "../../../packages/core/src/hooks/types.js";
import type { Profile } from "../../../packages/core/src/types.js";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    authType: "api-key",
    tool: "claude",
    configDir: "/tmp/arc-test",
    createdAt: new Date().toISOString(),
    enforcement: "log",
    ...overrides,
  };
}

function ctx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    message: "",
    sessionId: "s1",
    profile: makeProfile(),
    adapter: "claude",
    hookMetadata: {},
    ...overrides,
  };
}

function getState(store: HookStateStore, sessionId: string) {
  return store.get<RoundtableState>(sessionId, "roundtable", "roundtableState");
}

describe("roundtable hook — state machine", () => {
  it("creates initial state on @roundtable trigger with parsed agents and rounds", async () => {
    const store = new HookStateStore();
    const hook = createRoundtableHook(store);

    const result = await hook.check(
      ctx({
        adapter: "claude",
        message: "@roundtable should we deploy?\nrounds: 3\nagents: claude, codex, gemini",
      }),
    );

    expect(result.pass).toBe(true);
    expect(result.metadata).toMatchObject({
      roundtable: true,
      topic: "should we deploy?",
      currentRound: 1,
      totalRounds: 3,
      currentAgent: "claude",
    });

    const state = getState(store, "s1");
    expect(state).toBeDefined();
    expect(state!.agents).toEqual(["claude", "codex", "gemini"]);
    expect(state!.rounds).toBe(3);
    expect(state!.status).toBe("active");
    expect(state!.modes).toEqual({
      claude: "advocate",
      codex: "critic",
      gemini: "neutral",
    });
  });

  it("uses defaultRounds when not specified", async () => {
    const store = new HookStateStore();
    const hook = createRoundtableHook(store, { defaultRounds: 5 });
    await hook.check(
      ctx({ message: "@roundtable topic here\nagents: a, b" }),
    );
    expect(getState(store, "s1")!.rounds).toBe(5);
  });

  it("ignores a trigger when a roundtable is already active", async () => {
    const store = new HookStateStore();
    const hook = createRoundtableHook(store);

    await hook.check(
      ctx({ message: "@roundtable first topic\nagents: claude, codex" }),
    );
    const result = await hook.check(
      ctx({ message: "@roundtable new topic\nagents: x, y" }),
    );
    expect(result.flag).toMatch(/already active/);
    expect(result.metadata?.triggerIgnored).toBe(true);

    const state = getState(store, "s1");
    expect(state!.agents).toEqual(["claude", "codex"]); // unchanged
  });

  it("enforce mode blocks out-of-turn messages", async () => {
    const store = new HookStateStore();
    const hook = createRoundtableHook(store);
    await hook.check(
      ctx({
        message: "@roundtable topic\nagents: claude, codex",
        profile: makeProfile({ enforcement: "enforce" }),
      }),
    );

    // Codex speaks out of turn — claude is expected first.
    const result = await hook.check(
      ctx({
        adapter: "codex",
        message: "hello",
        profile: makeProfile({ enforcement: "enforce" }),
      }),
    );
    expect(result.pass).toBe(false);
    expect(result.block).toBe(true);
    expect(result.reason).toMatch(/claude/);
  });

  it("log mode records out-of-turn messages but does not block", async () => {
    const store = new HookStateStore();
    const hook = createRoundtableHook(store);
    await hook.check(
      ctx({ message: "@roundtable topic\nagents: claude, codex" }),
    );

    const result = await hook.check(ctx({ adapter: "codex", message: "hi" }));
    expect(result.pass).toBe(true);
    expect(result.block).toBeFalsy();
    expect(result.metadata?.outOfTurn).toBe(true);
  });

  it("advise mode flags out-of-turn but does not block", async () => {
    const store = new HookStateStore();
    const hook = createRoundtableHook(store);
    await hook.check(
      ctx({
        message: "@roundtable topic\nagents: claude, codex",
        profile: makeProfile({ enforcement: "advise" }),
      }),
    );
    const result = await hook.check(
      ctx({
        adapter: "codex",
        message: "hi",
        profile: makeProfile({ enforcement: "advise" }),
      }),
    );
    expect(result.pass).toBe(true);
    expect(result.flag).toMatch(/claude/);
  });

  it("postProcess advances turns and rounds until synthesizing", async () => {
    const store = new HookStateStore();
    const hook = createRoundtableHook(store, { defaultRounds: 2 });
    await hook.check(
      ctx({ message: "@roundtable topic\nagents: claude, codex" }),
    );

    const respond = async (agent: string, content: string) => {
      await hook.postProcess!(
        ctx({ adapter: agent }),
        { content } as AgentResponse,
      );
    };

    // Round 1
    await respond("claude", "r1-c");
    expect(getState(store, "s1")!.currentTurnIndex).toBe(1);
    expect(getState(store, "s1")!.currentRound).toBe(1);

    await respond("codex", "r1-x");
    expect(getState(store, "s1")!.currentTurnIndex).toBe(0);
    expect(getState(store, "s1")!.currentRound).toBe(2);

    // Round 2
    await respond("claude", "r2-c");
    await respond("codex", "r2-x");

    const final = getState(store, "s1")!;
    expect(final.status).toBe("synthesizing");
    expect(final.responses).toHaveLength(4);
  });

  it("out-of-turn response in log mode is recorded but does not advance turn", async () => {
    const store = new HookStateStore();
    const hook = createRoundtableHook(store);
    await hook.check(
      ctx({ message: "@roundtable topic\nagents: claude, codex" }),
    );

    await hook.postProcess!(
      ctx({ adapter: "codex" }), // out of turn
      { content: "jumped in" } as AgentResponse,
    );

    const state = getState(store, "s1")!;
    expect(state.currentTurnIndex).toBe(0); // still claude's turn
    expect(state.responses).toHaveLength(1); // but recorded
  });

  it("synthesizing → complete on next message through check()", async () => {
    const store = new HookStateStore();
    const hook = createRoundtableHook(store, { defaultRounds: 1 });
    await hook.check(
      ctx({ message: "@roundtable topic\nagents: claude, codex" }),
    );
    await hook.postProcess!(
      ctx({ adapter: "claude" }),
      { content: "a" } as AgentResponse,
    );
    await hook.postProcess!(
      ctx({ adapter: "codex" }),
      { content: "b" } as AgentResponse,
    );
    expect(getState(store, "s1")!.status).toBe("synthesizing");

    const result = await hook.check(
      ctx({ adapter: "claude", message: "synthesis message" }),
    );
    expect(result.metadata?.status).toBe("complete");
    expect(getState(store, "s1")!.status).toBe("complete");
  });

  it("inject() returns live metadata while active, undefined when complete", async () => {
    const store = new HookStateStore();
    const hook = createRoundtableHook(store);
    await hook.check(
      ctx({ message: "@roundtable topic\nagents: claude, codex" }),
    );

    const meta = hook.inject!(ctx());
    expect(meta).toMatchObject({
      roundtable: true,
      currentAgent: "claude",
      currentRound: 1,
      totalRounds: 2,
    });

    // Force complete
    const state = getState(store, "s1")!;
    state.status = "complete";
    store.set("s1", "roundtable", "roundtableState", state);
    expect(hook.inject!(ctx())).toBeUndefined();
  });
});
