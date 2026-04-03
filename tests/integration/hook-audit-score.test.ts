import { describe, it, expect } from "vitest";
import {
  auditCompletion,
  createAuditScoreHook,
  HookStateStore,
} from "@axiom-labs/arc-core";
import type {
  HookContext,
  HookResult,
  AgentResponse,
  CompletionAudit,
} from "../../packages/core/src/hooks/types.js";
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

function makeResponse(content: string, toolCalls?: unknown[]): AgentResponse {
  return { content, toolCalls };
}

// ─── auditCompletion() pure function ─────────────────────────────────

describe("auditCompletion()", () => {
  describe("status determination", () => {
    it("returns 'complete' for clear success message", () => {
      const audit = auditCompletion(makeResponse("Task done. All tests pass successfully."));
      expect(audit.status).toBe("complete");
      expect(audit.confidence).toBeGreaterThan(0.5);
      expect(audit.recommendation).toBe("complete");
    });

    it("returns 'failed' for failure message", () => {
      const audit = auditCompletion(makeResponse("The build failed with an error in module X."));
      expect(audit.status).toBe("failed");
      expect(audit.checksFailed).toContain("no-failure-signals");
    });

    it("returns 'partial' for mixed signals (completion + failure)", () => {
      const audit = auditCompletion(makeResponse("Task completed, but some tests failed."));
      expect(audit.status).toBe("partial");
      expect(audit.recommendation).toBe("continue");
    });

    it("returns 'partial' for completion + contradiction", () => {
      const audit = auditCompletion(makeResponse("I finished the task, however there are warnings."));
      expect(audit.status).toBe("partial");
    });

    it("returns 'uncertain' for vague content", () => {
      const audit = auditCompletion(makeResponse("I looked at the code and made some changes."));
      expect(audit.status).toBe("uncertain");
    });

    it("returns 'uncertain' for empty content", () => {
      const audit = auditCompletion(makeResponse(""));
      expect(audit.status).toBe("uncertain");
      expect(audit.confidence).toBe(0);
    });
  });

  describe("confidence scoring", () => {
    it("gives 0 confidence for empty content", () => {
      const audit = auditCompletion(makeResponse(""));
      expect(audit.confidence).toBe(0);
    });

    it("gives 0 confidence for whitespace-only content", () => {
      const audit = auditCompletion(makeResponse("   \n\t  "));
      expect(audit.confidence).toBe(0);
    });

    it("gives base 0.5 for content with no signals", () => {
      const audit = auditCompletion(makeResponse("I reviewed the module structure."));
      expect(audit.confidence).toBe(0.5);
    });

    it("adds 0.2 for completion signals (0.7 total)", () => {
      const audit = auditCompletion(makeResponse("Task done."));
      expect(audit.confidence).toBe(0.7);
    });

    it("subtracts 0.1 per contradiction/failure", () => {
      // base 0.5 + 0.2 (completion) - 0.1 (failure "failed") - 0.1 (contradiction "but") = 0.5
      const audit = auditCompletion(makeResponse("Done, but the deploy failed."));
      expect(audit.confidence).toBeCloseTo(0.5, 10);
    });

    it("clamps confidence to [0, 1]", () => {
      // Many failure signals should not go below 0
      const audit = auditCompletion(
        makeResponse("Failed with error, exception thrown, unable to proceed, cannot connect."),
      );
      expect(audit.confidence).toBeGreaterThanOrEqual(0);
      expect(audit.confidence).toBeLessThanOrEqual(1);
    });

    it("is deterministic — same input always gives same output", () => {
      const response = makeResponse("Task completed successfully, but there was a warning.");
      const a = auditCompletion(response);
      const b = auditCompletion(response);
      expect(a).toEqual(b);
    });
  });

  describe("recommendation matrix (§6.2)", () => {
    it("complete + any → 'complete'", () => {
      const audit = auditCompletion(makeResponse("All done successfully."));
      expect(audit.status).toBe("complete");
      expect(audit.recommendation).toBe("complete");
    });

    it("partial + any → 'continue'", () => {
      const audit = auditCompletion(makeResponse("Completed the main work, but some edge cases failed."));
      expect(audit.status).toBe("partial");
      expect(audit.recommendation).toBe("continue");
    });

    it("failed + confidence ≥ 0.3 → 'retry'", () => {
      // "failed" → status=failed, base 0.5 - 0.1 (failed) = 0.4 ≥ 0.3
      const audit = auditCompletion(makeResponse("The deployment failed."));
      expect(audit.status).toBe("failed");
      expect(audit.confidence).toBeGreaterThanOrEqual(0.3);
      expect(audit.recommendation).toBe("retry");
    });

    it("failed + confidence < 0.3 → 'escalate'", () => {
      // Many failure/contradiction signals to push confidence below 0.3
      // base 0.5 - 0.1(failed) - 0.1(error) - 0.1(unable) - 0.1(cannot) = 0.1
      const audit = auditCompletion(
        makeResponse("Failed with error, unable to proceed, cannot fix this."),
      );
      expect(audit.status).toBe("failed");
      expect(audit.confidence).toBeLessThan(0.3);
      expect(audit.recommendation).toBe("escalate");
    });

    it("uncertain + confidence ≥ 0.3 → 'continue'", () => {
      // No completion/failure signals: status=uncertain, confidence=0.5
      const audit = auditCompletion(makeResponse("I looked into the issue and made some notes."));
      expect(audit.status).toBe("uncertain");
      expect(audit.confidence).toBeGreaterThanOrEqual(0.3);
      expect(audit.recommendation).toBe("continue");
    });

    it("uncertain + confidence < 0.3 → 'escalate'", () => {
      // Empty content: status=uncertain, confidence=0
      const audit = auditCompletion(makeResponse(""));
      expect(audit.status).toBe("uncertain");
      expect(audit.confidence).toBeLessThan(0.3);
      expect(audit.recommendation).toBe("escalate");
    });
  });

  describe("overreach detection", () => {
    it("detects 'also' overreach", () => {
      const audit = auditCompletion(
        makeResponse("Task done. I also refactored the test suite."),
      );
      expect(audit.overreachDetected).toBe(true);
      expect(audit.checksFailed).toContain("no-overreach");
    });

    it("detects 'additionally' overreach", () => {
      const audit = auditCompletion(
        makeResponse("Finished. Additionally I updated the README."),
      );
      expect(audit.overreachDetected).toBe(true);
    });

    it("detects 'went ahead and' overreach", () => {
      const audit = auditCompletion(
        makeResponse("Completed the task. I went ahead and cleaned up the imports."),
      );
      expect(audit.overreachDetected).toBe(true);
    });

    it("no overreach when signals absent", () => {
      const audit = auditCompletion(makeResponse("Task done successfully."));
      expect(audit.overreachDetected).toBe(false);
      expect(audit.checksPassed).toContain("no-overreach");
    });
  });

  describe("malformed inputs (negative tests)", () => {
    it("handles empty string content", () => {
      const audit = auditCompletion(makeResponse(""));
      expect(audit.status).toBe("uncertain");
      expect(audit.confidence).toBe(0);
      expect(audit.recommendation).toBe("escalate");
    });

    it("handles whitespace-only content", () => {
      const audit = auditCompletion(makeResponse("   \n\t  "));
      expect(audit.status).toBe("uncertain");
      expect(audit.confidence).toBe(0);
      expect(audit.recommendation).toBe("escalate");
    });

    it("handles undefined toolCalls", () => {
      const audit = auditCompletion({ content: "done", toolCalls: undefined });
      expect(audit.status).toBe("complete");
    });

    it("handles response with only whitespace and no toolCalls", () => {
      const audit = auditCompletion({ content: "  " });
      expect(audit.status).toBe("uncertain");
      expect(audit.confidence).toBe(0);
    });
  });

  describe("checks passed/failed tracking", () => {
    it("tracks has-content check", () => {
      const empty = auditCompletion(makeResponse(""));
      expect(empty.checksFailed).toContain("has-content");

      const full = auditCompletion(makeResponse("some content"));
      expect(full.checksPassed).toContain("has-content");
    });

    it("tracks completion-signals check", () => {
      const yes = auditCompletion(makeResponse("Task done."));
      expect(yes.checksPassed).toContain("completion-signals");

      const no = auditCompletion(makeResponse("I looked at it."));
      expect(no.checksFailed).toContain("completion-signals");
    });

    it("provides empty missingSteps in v1", () => {
      const audit = auditCompletion(makeResponse("done"));
      expect(audit.missingSteps).toEqual([]);
    });
  });

  describe("LLM placeholder", () => {
    it("accepts llmComplete option without calling it", () => {
      let called = false;
      const audit = auditCompletion(makeResponse("done"), {
        llmComplete: async () => {
          called = true;
          return "llm result";
        },
      });
      expect(called).toBe(false);
      expect(audit.status).toBe("complete");
    });
  });
});

// ─── audit-score hook ────────────────────────────────────────────────

describe("audit-score hook", () => {
  describe("hook metadata", () => {
    it("has name 'audit-score'", () => {
      const store = new HookStateStore();
      const hook = createAuditScoreHook(store);
      expect(hook.name).toBe("audit-score");
    });

    it("subscribes to post-message events", () => {
      const store = new HookStateStore();
      const hook = createAuditScoreHook(store);
      expect(hook.events).toEqual(["post-message"]);
    });

    it("has priority 90", () => {
      const store = new HookStateStore();
      const hook = createAuditScoreHook(store);
      expect(hook.priority).toBe(90);
    });
  });

  describe("postProcess — writes audit to state store", () => {
    it("writes audit result after processing a response", async () => {
      const store = new HookStateStore();
      const hook = createAuditScoreHook(store);
      const ctx = makeCtx();
      const response = makeResponse("Task done successfully.");

      await hook.postProcess!(ctx, response);

      const audit = store.get<CompletionAudit>(ctx.sessionId, "audit-score", "auditResult");
      expect(audit).toBeDefined();
      expect(audit!.status).toBe("complete");
      expect(audit!.confidence).toBeGreaterThan(0.5);
      expect(audit!.recommendation).toBe("complete");
    });

    it("overwrites previous audit on subsequent calls", async () => {
      const store = new HookStateStore();
      const hook = createAuditScoreHook(store);
      const ctx = makeCtx();

      await hook.postProcess!(ctx, makeResponse("Task done."));
      const first = store.get<CompletionAudit>(ctx.sessionId, "audit-score", "auditResult");
      expect(first!.status).toBe("complete");

      await hook.postProcess!(ctx, makeResponse("Something failed with an error."));
      const second = store.get<CompletionAudit>(ctx.sessionId, "audit-score", "auditResult");
      expect(second!.status).toBe("failed");
    });
  });

  describe("check — reads state store and evaluates", () => {
    it("returns pass:true when no prior audit exists", () => {
      const store = new HookStateStore();
      const hook = createAuditScoreHook(store);
      const result = hook.check(makeCtx()) as HookResult;
      expect(result.pass).toBe(true);
      expect(result.block).toBeUndefined();
    });

    it("returns pass:true for high confidence in log mode", async () => {
      const store = new HookStateStore();
      const hook = createAuditScoreHook(store);
      const ctx = makeCtx({ profile: makeProfile("log") });

      await hook.postProcess!(ctx, makeResponse("Task done successfully."));
      const result = hook.check(ctx) as HookResult;

      expect(result.pass).toBe(true);
      expect(result.block).toBeFalsy();
    });

    it("flags but does not block low confidence in log mode", async () => {
      const store = new HookStateStore();
      const hook = createAuditScoreHook(store);
      const ctx = makeCtx({ profile: makeProfile("log") });

      await hook.postProcess!(ctx, makeResponse(""));
      // Empty content → confidence 0 → below threshold
      // But we need content in state store, so manually set low-confidence audit
      store.set(ctx.sessionId, "audit-score", "auditResult", {
        status: "uncertain",
        confidence: 0.2,
        recommendation: "escalate",
        checksPassed: [],
        checksFailed: [],
        missingSteps: [],
        overreachDetected: false,
      } satisfies CompletionAudit);

      const result = hook.check(ctx) as HookResult;
      expect(result.pass).toBe(true);
      expect(result.block).toBeFalsy();
      expect(result.flag).toBeDefined();
      expect(result.flag).toContain("0.2");
    });

    it("flags but does not block low confidence in advise mode", async () => {
      const store = new HookStateStore();
      const hook = createAuditScoreHook(store);
      const ctx = makeCtx({ profile: makeProfile("advise") });

      store.set(ctx.sessionId, "audit-score", "auditResult", {
        status: "uncertain",
        confidence: 0.1,
        recommendation: "escalate",
        checksPassed: [],
        checksFailed: [],
        missingSteps: [],
        overreachDetected: false,
      } satisfies CompletionAudit);

      const result = hook.check(ctx) as HookResult;
      expect(result.pass).toBe(true);
      expect(result.block).toBeFalsy();
      expect(result.flag).toBeDefined();
    });
  });

  describe("enforce mode blocking", () => {
    it("blocks when confidence < 0.4 in enforce mode", async () => {
      const store = new HookStateStore();
      const hook = createAuditScoreHook(store);
      const ctx = makeCtx({ profile: makeProfile("enforce") });

      store.set(ctx.sessionId, "audit-score", "auditResult", {
        status: "failed",
        confidence: 0.39,
        recommendation: "escalate",
        checksPassed: [],
        checksFailed: [],
        missingSteps: [],
        overreachDetected: false,
      } satisfies CompletionAudit);

      const result = hook.check(ctx) as HookResult;
      expect(result.pass).toBe(false);
      expect(result.block).toBe(true);
      expect(result.reason).toContain("0.39");
      expect(result.reason).toContain("0.4");
    });

    it("does NOT block when confidence exactly equals 0.4 in enforce mode", async () => {
      const store = new HookStateStore();
      const hook = createAuditScoreHook(store);
      const ctx = makeCtx({ profile: makeProfile("enforce") });

      store.set(ctx.sessionId, "audit-score", "auditResult", {
        status: "uncertain",
        confidence: 0.4,
        recommendation: "continue",
        checksPassed: [],
        checksFailed: [],
        missingSteps: [],
        overreachDetected: false,
      } satisfies CompletionAudit);

      const result = hook.check(ctx) as HookResult;
      expect(result.pass).toBe(true);
      expect(result.block).toBeFalsy();
    });

    it("does NOT block when confidence > 0.4 in enforce mode", async () => {
      const store = new HookStateStore();
      const hook = createAuditScoreHook(store);
      const ctx = makeCtx({ profile: makeProfile("enforce") });

      await hook.postProcess!(ctx, makeResponse("Task done successfully."));
      const result = hook.check(ctx) as HookResult;

      expect(result.pass).toBe(true);
      expect(result.block).toBeFalsy();
    });
  });

  describe("metadata in check result", () => {
    it("includes audit status, confidence, and recommendation", async () => {
      const store = new HookStateStore();
      const hook = createAuditScoreHook(store);
      const ctx = makeCtx();

      await hook.postProcess!(ctx, makeResponse("Task done."));
      const result = hook.check(ctx) as HookResult;

      expect(result.metadata).toBeDefined();
      expect(result.metadata!.auditStatus).toBe("complete");
      expect(result.metadata!.auditConfidence).toBe(0.7);
      expect(result.metadata!.auditRecommendation).toBe("complete");
    });
  });

  describe("session isolation", () => {
    it("audit results from one session don't leak to another", async () => {
      const store = new HookStateStore();
      const hook = createAuditScoreHook(store);

      const ctx1 = makeCtx({ sessionId: "sess-A" });
      const ctx2 = makeCtx({ sessionId: "sess-B" });

      await hook.postProcess!(ctx1, makeResponse("Task done."));

      // Session B has no audit
      const result = hook.check(ctx2) as HookResult;
      expect(result.pass).toBe(true);
      expect(result.metadata).toBeUndefined();
    });
  });
});
