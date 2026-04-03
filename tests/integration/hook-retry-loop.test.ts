import { describe, it, expect, vi } from "vitest";
import {
  HookBus,
  HookStateStore,
  createAttemptTracker,
  createAuditScoreHook,
  runWithRetry,
  createDefaultPipeline,
} from "@axiom-labs/arc-core";
import type {
  HookContext,
  AgentResponse,
  CompletionAudit,
  EnforcementMode,
} from "../../packages/core/src/hooks/types.js";
import type { Profile } from "@axiom-labs/arc-core";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeProfile(enforcement?: EnforcementMode): Profile {
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
    sessionId: "sess-retry",
    profile: makeProfile("enforce"),
    adapter: "test-adapter",
    turnId: "turn-001",
    ...overrides,
  };
}

function makeResponse(content: string): AgentResponse {
  return { content };
}

/** Build a minimal bus with attempt-tracker + audit-score for retry testing. */
function makeRetryBus(stateStore?: HookStateStore) {
  const store = stateStore ?? new HookStateStore();
  const bus = new HookBus();
  bus.register(createAttemptTracker(store));
  bus.register(createAuditScoreHook(store));
  return { bus, stateStore: store };
}

// ─── runWithRetry ────────────────────────────────────────────────────

describe("runWithRetry()", () => {
  describe("enforce mode — retries on low confidence", () => {
    it("retries when first response has low confidence, succeeds on second", async () => {
      const { bus, stateStore } = makeRetryBus();
      let callCount = 0;

      const result = await runWithRetry({
        bus,
        stateStore,
        ctx: makeCtx(),
        enforcement: "enforce",
        executeAgent: async () => {
          callCount++;
          // First call: failure signals → conf 0.5 - 0.1 = 0.4, but "error" alone → conf 0.4
          // Need two failures to get below 0.4: "error unable" → 0.5 - 0.2 = 0.3
          if (callCount === 1) return makeResponse("error unable to proceed");
          // Second call: clear completion
          return makeResponse("done, all tests pass");
        },
      });

      expect(result.attempts).toBe(2);
      expect(callCount).toBe(2);
      expect(result.auditResult).toBeDefined();
      expect(result.auditResult!.status).toBe("complete");
      expect(result.auditResult!.confidence).toBeGreaterThanOrEqual(0.4);
      expect(result.response.content).toBe("done, all tests pass");
    });

    it("respects maxAttempts — stops after max even with low confidence", async () => {
      const { bus, stateStore } = makeRetryBus();
      let callCount = 0;

      const result = await runWithRetry({
        bus,
        stateStore,
        ctx: makeCtx(),
        enforcement: "enforce",
        executeAgent: async () => {
          callCount++;
          // Two failure signals → conf 0.5 - 0.2 = 0.3, below threshold
          return makeResponse("error: unable to complete");
        },
        maxAttempts: 3,
      });

      expect(result.attempts).toBe(3);
      expect(callCount).toBe(3);
      // Confidence should still be low
      expect(result.auditResult).toBeDefined();
      expect(result.auditResult!.confidence).toBeLessThan(0.4);
    });

    it("does not retry when first response has high confidence", async () => {
      const { bus, stateStore } = makeRetryBus();
      let callCount = 0;

      const result = await runWithRetry({
        bus,
        stateStore,
        ctx: makeCtx(),
        enforcement: "enforce",
        executeAgent: async () => {
          callCount++;
          return makeResponse("Task completed successfully. All tests pass.");
        },
      });

      expect(result.attempts).toBe(1);
      expect(callCount).toBe(1);
      expect(result.auditResult!.status).toBe("complete");
    });
  });

  describe("non-enforce modes — no retry", () => {
    it("enforcement='log' runs exactly once regardless of confidence", async () => {
      const { bus, stateStore } = makeRetryBus();
      let callCount = 0;

      const result = await runWithRetry({
        bus,
        stateStore,
        ctx: makeCtx({ profile: makeProfile("log") }),
        enforcement: "log",
        executeAgent: async () => {
          callCount++;
          return makeResponse("unclear response");
        },
      });

      expect(result.attempts).toBe(1);
      expect(callCount).toBe(1);
    });

    it("enforcement='advise' runs exactly once regardless of confidence", async () => {
      const { bus, stateStore } = makeRetryBus();
      let callCount = 0;

      const result = await runWithRetry({
        bus,
        stateStore,
        ctx: makeCtx({ profile: makeProfile("advise") }),
        enforcement: "advise",
        executeAgent: async () => {
          callCount++;
          return makeResponse("unclear response");
        },
      });

      expect(result.attempts).toBe(1);
      expect(callCount).toBe(1);
    });

    it("enforcement='off' runs exactly once", async () => {
      const { bus, stateStore } = makeRetryBus();
      let callCount = 0;

      const result = await runWithRetry({
        bus,
        stateStore,
        ctx: makeCtx({ profile: makeProfile("off") }),
        enforcement: "off",
        executeAgent: async () => {
          callCount++;
          return makeResponse("unclear response");
        },
      });

      expect(result.attempts).toBe(1);
      expect(callCount).toBe(1);
    });
  });

  describe("custom thresholds", () => {
    it("custom confidenceThreshold allows lower bar", async () => {
      const { bus, stateStore } = makeRetryBus();
      let callCount = 0;

      // "unclear response" has confidence 0.5 (has content, no signals)
      // With threshold 0.6, it would retry; with 0.4 (default), it wouldn't
      const result = await runWithRetry({
        bus,
        stateStore,
        ctx: makeCtx(),
        enforcement: "enforce",
        executeAgent: async () => {
          callCount++;
          if (callCount === 1) return makeResponse("unclear response");
          return makeResponse("done, finished successfully");
        },
        confidenceThreshold: 0.6,
      });

      // "unclear response" has conf 0.5 < 0.6 threshold, so retries
      expect(result.attempts).toBe(2);
      expect(callCount).toBe(2);
    });

    it("custom maxAttempts limits retries", async () => {
      const { bus, stateStore } = makeRetryBus();
      let callCount = 0;

      const result = await runWithRetry({
        bus,
        stateStore,
        ctx: makeCtx(),
        enforcement: "enforce",
        executeAgent: async () => {
          callCount++;
          // Two failure signals → conf 0.3, below default 0.4 threshold
          return makeResponse("failed with exception thrown");
        },
        maxAttempts: 5,
      });

      expect(result.attempts).toBe(5);
      expect(callCount).toBe(5);
    });

    it("maxAttempts=1 means no retries even in enforce mode", async () => {
      const { bus, stateStore } = makeRetryBus();
      let callCount = 0;

      const result = await runWithRetry({
        bus,
        stateStore,
        ctx: makeCtx(),
        enforcement: "enforce",
        executeAgent: async () => {
          callCount++;
          return makeResponse("unclear");
        },
        maxAttempts: 1,
      });

      expect(result.attempts).toBe(1);
      expect(callCount).toBe(1);
    });
  });

  describe("output shape", () => {
    it("returns auditResult from the final attempt", async () => {
      const { bus, stateStore } = makeRetryBus();

      const result = await runWithRetry({
        bus,
        stateStore,
        ctx: makeCtx(),
        enforcement: "enforce",
        executeAgent: async () => makeResponse("Task done. All tests pass."),
      });

      expect(result.auditResult).toBeDefined();
      expect(result.auditResult!.status).toBe("complete");
      expect(result.auditResult!.confidence).toBeGreaterThan(0.5);
      expect(result.auditResult!.recommendation).toBe("complete");
      expect(result.response.content).toBe("Task done. All tests pass.");
    });

    it("returns undefined auditResult when no audit-score hook is registered", async () => {
      const stateStore = new HookStateStore();
      const bus = new HookBus();
      // No hooks registered — stateStore stays empty

      const result = await runWithRetry({
        bus,
        stateStore,
        ctx: makeCtx(),
        enforcement: "enforce",
        executeAgent: async () => makeResponse("some response"),
      });

      // With no audit hook, confidence defaults to 0 < threshold, so retries up to max
      expect(result.attempts).toBe(3);
      expect(result.auditResult).toBeUndefined();
    });
  });

  describe("error propagation", () => {
    it("propagates executeAgent errors without retrying", async () => {
      const { bus, stateStore } = makeRetryBus();
      let callCount = 0;

      await expect(
        runWithRetry({
          bus,
          stateStore,
          ctx: makeCtx(),
          enforcement: "enforce",
          executeAgent: async () => {
            callCount++;
            throw new Error("Agent crashed");
          },
        }),
      ).rejects.toThrow("Agent crashed");

      expect(callCount).toBe(1);
    });

    it("propagates error even after successful first attempt", async () => {
      const { bus, stateStore } = makeRetryBus();
      let callCount = 0;

      await expect(
        runWithRetry({
          bus,
          stateStore,
          ctx: makeCtx(),
          enforcement: "enforce",
          executeAgent: async () => {
            callCount++;
            // First call: low confidence (two failure signals → conf 0.3)
            if (callCount === 1) return makeResponse("error unable to proceed");
            // Second call: crash
            throw new Error("Second attempt failed");
          },
        }),
      ).rejects.toThrow("Second attempt failed");

      expect(callCount).toBe(2);
    });
  });

  describe("integration with attempt-tracker state", () => {
    it("attempt-tracker increments correctly across retries", async () => {
      const stateStore = new HookStateStore();
      const { bus } = makeRetryBus(stateStore);
      let callCount = 0;

      await runWithRetry({
        bus,
        stateStore,
        ctx: makeCtx(),
        enforcement: "enforce",
        executeAgent: async () => {
          callCount++;
          // First two: low confidence (two failure signals → conf 0.3)
          if (callCount < 3) return makeResponse("error unable to proceed");
          return makeResponse("done, completed successfully");
        },
      });

      // Attempt tracker stores under attemptCount:<turnId>
      const count = stateStore.get<number>(
        "sess-retry",
        "attempt-tracker",
        "attemptCount:turn-001",
      );
      expect(count).toBe(3); // 3 iterations, each incremented by postProcess
    });
  });
});

// ─── createDefaultPipeline ───────────────────────────────────────────

describe("createDefaultPipeline()", () => {
  it("returns bus and stateStore", () => {
    const pipeline = createDefaultPipeline();
    expect(pipeline.bus).toBeInstanceOf(HookBus);
    expect(pipeline.stateStore).toBeInstanceOf(HookStateStore);
  });

  it("registers all 5 default hooks in correct priority order", () => {
    const pipeline = createDefaultPipeline();
    const hooks = pipeline.bus.list();
    const names = hooks.map((h) => h.name);

    expect(names).toContain("source-classify");
    expect(names).toContain("interagent-routing");
    expect(names).toContain("risk-detection");
    expect(names).toContain("attempt-tracker");
    expect(names).toContain("audit-score");
    expect(hooks.length).toBe(5);

    // Priority ordering
    const priorities = hooks.map((h) => h.priority);
    const sorted = [...priorities].sort((a, b) => a - b);
    expect(priorities).toEqual(sorted);
  });

  it("applies per-hook config overrides", () => {
    const pipeline = createDefaultPipeline({
      "audit-score": { enabled: false, timeout: 1000 },
    });
    const hooks = pipeline.bus.list();
    expect(hooks.length).toBe(5); // still registered, just config'd
  });

  it("stateStore is shared between attempt-tracker and audit-score hooks", async () => {
    const pipeline = createDefaultPipeline();
    const ctx = makeCtx();

    // Run post-hooks to deposit state
    await pipeline.bus.runPost(ctx, makeResponse("done, finished"), "enforce", "post-message");

    // audit-score should have written to the shared stateStore
    const audit = pipeline.stateStore.get<CompletionAudit>(
      "sess-retry",
      "audit-score",
      "auditResult",
    );
    expect(audit).toBeDefined();
    expect(audit!.status).toBe("complete");

    // attempt-tracker should have incremented
    const count = pipeline.stateStore.get<number>(
      "sess-retry",
      "attempt-tracker",
      "attemptCount:turn-001",
    );
    expect(count).toBe(1);
  });
});

// ─── End-to-end: full pipeline with retry ────────────────────────────

describe("end-to-end: createDefaultPipeline + runWithRetry", () => {
  it("full lifecycle: low-confidence → retry → success", async () => {
    const { bus, stateStore } = createDefaultPipeline();
    let callCount = 0;

    const result = await runWithRetry({
      bus,
      stateStore,
      ctx: makeCtx({ source: "user" }),
      enforcement: "enforce",
      executeAgent: async () => {
        callCount++;
        // First call: two failure signals → conf 0.3, below threshold
        if (callCount === 1) return makeResponse("error unable to complete task");
        return makeResponse("done, all tests pass, completed");
      },
    });

    expect(result.attempts).toBe(2);
    expect(result.auditResult!.status).toBe("complete");
    expect(result.response.content).toContain("all tests pass");
  });

  it("full lifecycle: always low-confidence → exhausts maxAttempts", async () => {
    const { bus, stateStore } = createDefaultPipeline();
    let callCount = 0;

    const result = await runWithRetry({
      bus,
      stateStore,
      ctx: makeCtx({ source: "user" }),
      enforcement: "enforce",
      executeAgent: async () => {
        callCount++;
        // Two failure signals → conf 0.3, below threshold
        return makeResponse("error unable to proceed");
      },
      maxAttempts: 2,
    });

    expect(result.attempts).toBe(2);
    expect(callCount).toBe(2);
    expect(result.auditResult!.confidence).toBeLessThan(0.4);
  });
});
