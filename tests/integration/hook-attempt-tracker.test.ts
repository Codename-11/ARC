import { describe, it, expect } from "vitest";
import { createAttemptTracker, HookStateStore } from "@axiom-labs/arc-core";
import type { HookContext, HookResult, AgentResponse } from "../../packages/core/src/hooks/types.js";
import type { Profile } from "@axiom-labs/arc-core";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeProfile(enforcement?: "log" | "advise" | "enforce"): Profile {
  return {
    authType: "api-key",
    configDir: "/tmp/test",
    createdAt: "2026-01-01T00:00:00Z",
    enforcement,
  } satisfies Profile;
}

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    message: "test message",
    sessionId: "sess-001",
    profile: makeProfile(),
    adapter: "test-adapter",
    ...overrides,
  };
}

const dummyResponse: AgentResponse = { content: "agent reply" };

// ─── Tests ───────────────────────────────────────────────────────────

describe("attempt-tracker hook", () => {
  describe("hook metadata", () => {
    it("has name 'attempt-tracker'", () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store);
      expect(hook.name).toBe("attempt-tracker");
    });

    it("subscribes to post-message events", () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store);
      expect(hook.events).toEqual(["post-message"]);
    });

    it("has priority 20", () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store);
      expect(hook.priority).toBe(20);
    });
  });

  describe("postProcess() — attempt counting", () => {
    it("increments attempt count on each postProcess call", async () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store);
      const ctx = makeCtx({ turnId: "turn-1" });

      await hook.postProcess!(ctx, dummyResponse);
      let result = hook.check(ctx) as HookResult;
      expect(result.metadata?.attemptCount).toBe(1);

      await hook.postProcess!(ctx, dummyResponse);
      result = hook.check(ctx) as HookResult;
      expect(result.metadata?.attemptCount).toBe(2);

      await hook.postProcess!(ctx, dummyResponse);
      result = hook.check(ctx) as HookResult;
      expect(result.metadata?.attemptCount).toBe(3);
    });

    it("starts at 0 attempts for a fresh turn", () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store);
      const ctx = makeCtx({ turnId: "turn-new" });

      const result = hook.check(ctx) as HookResult;
      expect(result.metadata?.attemptCount).toBe(0);
    });
  });

  describe("turnId scoping", () => {
    it("separate turnIds get separate counters", async () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store);

      const ctxA = makeCtx({ turnId: "turn-a" });
      const ctxB = makeCtx({ turnId: "turn-b" });

      await hook.postProcess!(ctxA, dummyResponse);
      await hook.postProcess!(ctxA, dummyResponse);
      await hook.postProcess!(ctxB, dummyResponse);

      const resultA = hook.check(ctxA) as HookResult;
      const resultB = hook.check(ctxB) as HookResult;

      expect(resultA.metadata?.attemptCount).toBe(2);
      expect(resultB.metadata?.attemptCount).toBe(1);
    });

    it("falls back to sessionId when turnId is undefined", async () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store);

      const ctx = makeCtx({ turnId: undefined });
      await hook.postProcess!(ctx, dummyResponse);

      const result = hook.check(ctx) as HookResult;
      expect(result.metadata?.attemptCount).toBe(1);
    });

    it("sessionId fallback is isolated from explicit turnId", async () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store);

      const ctxNoTurn = makeCtx({ turnId: undefined, sessionId: "sess-x" });
      const ctxWithTurn = makeCtx({ turnId: "turn-1", sessionId: "sess-x" });

      await hook.postProcess!(ctxNoTurn, dummyResponse);
      await hook.postProcess!(ctxWithTurn, dummyResponse);

      const resultNoTurn = hook.check(ctxNoTurn) as HookResult;
      const resultWithTurn = hook.check(ctxWithTurn) as HookResult;

      // "sess-x" (fallback) vs "turn-1" — different keys
      expect(resultNoTurn.metadata?.attemptCount).toBe(1);
      expect(resultWithTurn.metadata?.attemptCount).toBe(1);
    });
  });

  describe("enforce mode", () => {
    it("shouldRetry is true when under maxAttempts", async () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store, { maxAttempts: 3 });
      const ctx = makeCtx({ turnId: "turn-1", profile: makeProfile("enforce") });

      await hook.postProcess!(ctx, dummyResponse); // count = 1
      const result = hook.check(ctx) as HookResult;

      expect(result.metadata?.shouldRetry).toBe(true);
      expect(result.pass).toBe(true);
      expect(result.block).toBeFalsy();
    });

    it("shouldRetry is false and blocks at maxAttempts", async () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store, { maxAttempts: 2 });
      const ctx = makeCtx({ turnId: "turn-1", profile: makeProfile("enforce") });

      await hook.postProcess!(ctx, dummyResponse); // count = 1
      await hook.postProcess!(ctx, dummyResponse); // count = 2

      const result = hook.check(ctx) as HookResult;
      expect(result.metadata?.attemptCount).toBe(2);
      expect(result.metadata?.shouldRetry).toBe(false);
      expect(result.pass).toBe(false);
      expect(result.block).toBe(true);
      expect(result.reason).toContain("max attempts");
    });

    it("shouldRetry is false and blocks when over maxAttempts", async () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store, { maxAttempts: 1 });
      const ctx = makeCtx({ turnId: "turn-1", profile: makeProfile("enforce") });

      await hook.postProcess!(ctx, dummyResponse); // count = 1
      await hook.postProcess!(ctx, dummyResponse); // count = 2

      const result = hook.check(ctx) as HookResult;
      expect(result.metadata?.attemptCount).toBe(2);
      expect(result.metadata?.shouldRetry).toBe(false);
      expect(result.block).toBe(true);
    });

    it("defaults maxAttempts to 3", async () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store);
      const ctx = makeCtx({ turnId: "turn-1", profile: makeProfile("enforce") });

      // 2 attempts — still under default max of 3
      await hook.postProcess!(ctx, dummyResponse);
      await hook.postProcess!(ctx, dummyResponse);
      let result = hook.check(ctx) as HookResult;
      expect(result.metadata?.shouldRetry).toBe(true);
      expect(result.metadata?.maxAttempts).toBe(3);

      // 3rd attempt — at max
      await hook.postProcess!(ctx, dummyResponse);
      result = hook.check(ctx) as HookResult;
      expect(result.metadata?.shouldRetry).toBe(false);
      expect(result.block).toBe(true);
    });
  });

  describe("log mode", () => {
    it("shouldRetry is always false", async () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store, { maxAttempts: 2 });
      const ctx = makeCtx({ turnId: "turn-1", profile: makeProfile("log") });

      await hook.postProcess!(ctx, dummyResponse);
      let result = hook.check(ctx) as HookResult;
      expect(result.metadata?.shouldRetry).toBe(false);
      expect(result.pass).toBe(true);

      await hook.postProcess!(ctx, dummyResponse); // at max
      result = hook.check(ctx) as HookResult;
      expect(result.metadata?.shouldRetry).toBe(false);
      expect(result.pass).toBe(true); // does NOT block in log mode
      expect(result.block).toBeFalsy();
    });
  });

  describe("advise mode", () => {
    it("shouldRetry is always false, never blocks", async () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store, { maxAttempts: 1 });
      const ctx = makeCtx({ turnId: "turn-1", profile: makeProfile("advise") });

      await hook.postProcess!(ctx, dummyResponse); // at max
      const result = hook.check(ctx) as HookResult;
      expect(result.metadata?.shouldRetry).toBe(false);
      expect(result.pass).toBe(true);
      expect(result.block).toBeFalsy();
    });
  });

  describe("default enforcement", () => {
    it("defaults to log mode when profile.enforcement is undefined", async () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store, { maxAttempts: 1 });
      const ctx = makeCtx({ turnId: "turn-1", profile: makeProfile(undefined) });

      await hook.postProcess!(ctx, dummyResponse); // at max
      const result = hook.check(ctx) as HookResult;
      // log mode: shouldRetry false, no block
      expect(result.metadata?.shouldRetry).toBe(false);
      expect(result.pass).toBe(true);
    });
  });

  describe("metadata shape", () => {
    it("always includes attemptCount, maxAttempts, shouldRetry", () => {
      const store = new HookStateStore();
      const hook = createAttemptTracker(store, { maxAttempts: 5 });
      const ctx = makeCtx({ turnId: "turn-1" });

      const result = hook.check(ctx) as HookResult;
      expect(result.metadata).toEqual({
        attemptCount: 0,
        maxAttempts: 5,
        shouldRetry: false,
      });
    });
  });
});
