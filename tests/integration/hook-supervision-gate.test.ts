import { describe, it, expect, vi } from "vitest";
import {
  createSupervisionGateHook,
  isSubstantive,
  parseGateResponse,
  HookStateStore,
} from "@axiom-labs/arc-core";
import type {
  HookContext,
  HookResult,
  AgentResponse,
} from "../../packages/core/src/hooks/types.js";
import type {
  GateReviewContext,
  SupervisionGateOptions,
} from "../../packages/core/src/hooks/supervision-gate.js";
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

// ─── isSubstantive() ─────────────────────────────────────────────────

describe("isSubstantive()", () => {
  it("returns true when toolCalls are present", () => {
    expect(isSubstantive(makeResponse("hello", [{ name: "write_file" }]))).toBe(true);
  });

  it("returns true for 'created file' in content", () => {
    expect(isSubstantive(makeResponse("I created file src/index.ts"))).toBe(true);
  });

  it("returns true for 'modified' in content", () => {
    expect(isSubstantive(makeResponse("I modified the config"))).toBe(true);
  });

  it("returns true for 'wrote to' in content", () => {
    expect(isSubstantive(makeResponse("I wrote to the database"))).toBe(true);
  });

  it("returns true for 'deleted' in content", () => {
    expect(isSubstantive(makeResponse("I deleted the old file"))).toBe(true);
  });

  it("returns false for plain text with no indicators", () => {
    expect(isSubstantive(makeResponse("I reviewed the code and it looks fine"))).toBe(false);
  });

  it("returns false for empty content and no toolCalls", () => {
    expect(isSubstantive(makeResponse(""))).toBe(false);
  });

  it("returns false when toolCalls is empty array", () => {
    expect(isSubstantive(makeResponse("hello", []))).toBe(false);
  });
});

// ─── parseGateResponse() ─────────────────────────────────────────────

describe("parseGateResponse()", () => {
  it("parses 'ALLOW: reason text'", () => {
    const r = parseGateResponse("ALLOW: looks good to me");
    expect(r.decision).toBe("ALLOW");
    expect(r.reason).toBe("looks good to me");
    expect(r.unknown).toBe(false);
  });

  it("parses 'BLOCK: reason text'", () => {
    const r = parseGateResponse("BLOCK: unsafe operation detected");
    expect(r.decision).toBe("BLOCK");
    expect(r.reason).toBe("unsafe operation detected");
    expect(r.unknown).toBe(false);
  });

  it("handles case-insensitive 'allow:'", () => {
    const r = parseGateResponse("allow: ok");
    expect(r.decision).toBe("ALLOW");
    expect(r.reason).toBe("ok");
    expect(r.unknown).toBe(false);
  });

  it("handles case-insensitive 'Block:'", () => {
    const r = parseGateResponse("Block: nope");
    expect(r.decision).toBe("BLOCK");
    expect(r.reason).toBe("nope");
    expect(r.unknown).toBe(false);
  });

  it("handles 'ALLOW:' with no reason text", () => {
    const r = parseGateResponse("ALLOW:");
    expect(r.decision).toBe("ALLOW");
    expect(r.reason).toBe("no reason provided");
    expect(r.unknown).toBe(false);
  });

  it("handles 'BLOCK:' with no reason text", () => {
    const r = parseGateResponse("BLOCK:");
    expect(r.decision).toBe("BLOCK");
    expect(r.reason).toBe("no reason provided");
    expect(r.unknown).toBe(false);
  });

  it("handles 'ALLOW' without colon", () => {
    const r = parseGateResponse("ALLOW");
    expect(r.decision).toBe("ALLOW");
    expect(r.reason).toBe("no reason provided");
    expect(r.unknown).toBe(false);
  });

  it("treats unknown format as ALLOW with unknown=true", () => {
    const r = parseGateResponse("some random text");
    expect(r.decision).toBe("ALLOW");
    expect(r.reason).toContain("unknown format");
    expect(r.unknown).toBe(true);
  });

  it("treats empty string as ALLOW with unknown=true", () => {
    const r = parseGateResponse("");
    expect(r.decision).toBe("ALLOW");
    expect(r.reason).toBe("empty supervisor response");
    expect(r.unknown).toBe(true);
  });

  it("treats null/undefined as ALLOW with unknown=true", () => {
    const r = parseGateResponse(null as unknown as string);
    expect(r.decision).toBe("ALLOW");
    expect(r.unknown).toBe(true);
  });

  it("treats whitespace-only as ALLOW with unknown=true", () => {
    const r = parseGateResponse("   \n\t  ");
    expect(r.decision).toBe("ALLOW");
    expect(r.unknown).toBe(true);
  });

  it("uses only the first line of multi-line response", () => {
    const r = parseGateResponse("BLOCK: risky\nMore details here\nAnother line");
    expect(r.decision).toBe("BLOCK");
    expect(r.reason).toBe("risky");
  });
});

// ─── createSupervisionGateHook — hook metadata ──────────────────────

describe("createSupervisionGateHook", () => {
  describe("hook metadata", () => {
    it("has name 'supervision-gate'", () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({ stateStore: store });
      expect(hook.name).toBe("supervision-gate");
    });

    it("subscribes to post-message events", () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({ stateStore: store });
      expect(hook.events).toEqual(["post-message"]);
    });

    it("has priority 92", () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({ stateStore: store });
      expect(hook.priority).toBe(92);
    });
  });

  // ─── Default supervisorFn ────────────────────────────────────────

  describe("default supervisorFn (pass-through)", () => {
    it("returns ALLOW for substantive turns with default supervisor", async () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({ stateStore: store });
      const ctx = makeCtx();

      await hook.postProcess!(ctx, makeResponse("I modified the config", [{ name: "edit" }]));

      const stored = store.get<{ decision: string }>(ctx.sessionId, "supervision-gate", "gateDecision");
      expect(stored).toBeDefined();
      expect(stored!.decision).toBe("ALLOW");
    });
  });

  // ─── postProcess — substantive detection ─────────────────────────

  describe("postProcess — substantive detection", () => {
    it("invokes supervisor for turns with toolCalls", async () => {
      const supervisorFn = vi.fn().mockResolvedValue("ALLOW: reviewed");
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({ stateStore: store, supervisorFn });
      const ctx = makeCtx();

      await hook.postProcess!(ctx, makeResponse("did stuff", [{ name: "write_file" }]));

      expect(supervisorFn).toHaveBeenCalledTimes(1);
      const reviewCtx = supervisorFn.mock.calls[0][0] as GateReviewContext;
      expect(reviewCtx.toolCallsSummary).toEqual(["write_file"]);
    });

    it("invokes supervisor for file-change keywords", async () => {
      const supervisorFn = vi.fn().mockResolvedValue("ALLOW: ok");
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({ stateStore: store, supervisorFn });
      const ctx = makeCtx();

      await hook.postProcess!(ctx, makeResponse("I created file src/main.ts"));

      expect(supervisorFn).toHaveBeenCalledTimes(1);
    });

    it("skips supervisor for non-substantive turns (onlySubstantive=true)", async () => {
      const supervisorFn = vi.fn().mockResolvedValue("ALLOW: ok");
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({ stateStore: store, supervisorFn });
      const ctx = makeCtx();

      await hook.postProcess!(ctx, makeResponse("I reviewed the code and it looks fine"));

      expect(supervisorFn).not.toHaveBeenCalled();
      const stored = store.get<{ decision: string; substantive: boolean }>(ctx.sessionId, "supervision-gate", "gateDecision");
      expect(stored!.decision).toBe("ALLOW");
      expect(stored!.substantive).toBe(false);
    });

    it("invokes supervisor for all turns when onlySubstantive=false", async () => {
      const supervisorFn = vi.fn().mockResolvedValue("BLOCK: not allowed");
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({ stateStore: store, supervisorFn, onlySubstantive: false });
      const ctx = makeCtx();

      await hook.postProcess!(ctx, makeResponse("just a comment"));

      expect(supervisorFn).toHaveBeenCalledTimes(1);
      const stored = store.get<{ decision: string }>(ctx.sessionId, "supervision-gate", "gateDecision");
      expect(stored!.decision).toBe("BLOCK");
    });
  });

  // ─── postProcess — GateReviewContext construction ────────────────

  describe("postProcess — GateReviewContext", () => {
    it("passes correct message and sessionId to supervisorFn", async () => {
      const supervisorFn = vi.fn().mockResolvedValue("ALLOW: ok");
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({ stateStore: store, supervisorFn });
      const ctx = makeCtx({ message: "deploy to prod", sessionId: "sess-xyz" });

      await hook.postProcess!(ctx, makeResponse("deployed", [{ name: "deploy" }]));

      const reviewCtx = supervisorFn.mock.calls[0][0] as GateReviewContext;
      expect(reviewCtx.message).toBe("deploy to prod");
      expect(reviewCtx.sessionId).toBe("sess-xyz");
      expect(reviewCtx.responseContent).toBe("deployed");
    });

    it("handles toolCalls without 'name' property", async () => {
      const supervisorFn = vi.fn().mockResolvedValue("ALLOW: ok");
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({ stateStore: store, supervisorFn });
      const ctx = makeCtx();

      await hook.postProcess!(ctx, makeResponse("stuff", [{ id: 1 }, "raw-string"]));

      const reviewCtx = supervisorFn.mock.calls[0][0] as GateReviewContext;
      expect(reviewCtx.toolCallsSummary).toEqual(["unknown", "unknown"]);
    });
  });

  // ─── postProcess — gate decision persistence ─────────────────────

  describe("postProcess — persistence", () => {
    it("stores ALLOW decision in state store", async () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({
        stateStore: store,
        supervisorFn: async () => "ALLOW: safe",
      });
      const ctx = makeCtx();

      await hook.postProcess!(ctx, makeResponse("modified thing", [{ name: "x" }]));

      const stored = store.get<{ decision: string; reason: string }>(
        ctx.sessionId, "supervision-gate", "gateDecision",
      );
      expect(stored!.decision).toBe("ALLOW");
      expect(stored!.reason).toBe("safe");
    });

    it("stores BLOCK decision in state store", async () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({
        stateStore: store,
        supervisorFn: async () => "BLOCK: dangerous operation",
      });
      const ctx = makeCtx();

      await hook.postProcess!(ctx, makeResponse("deleted stuff", [{ name: "rm" }]));

      const stored = store.get<{ decision: string; reason: string }>(
        ctx.sessionId, "supervision-gate", "gateDecision",
      );
      expect(stored!.decision).toBe("BLOCK");
      expect(stored!.reason).toBe("dangerous operation");
    });

    it("overwrites previous decision on subsequent calls", async () => {
      const store = new HookStateStore();
      let callCount = 0;
      const hook = createSupervisionGateHook({
        stateStore: store,
        supervisorFn: async () => {
          callCount++;
          return callCount === 1 ? "BLOCK: first" : "ALLOW: second";
        },
      });
      const ctx = makeCtx();

      await hook.postProcess!(ctx, makeResponse("modified A", [{ name: "x" }]));
      expect(store.get<{ decision: string }>(ctx.sessionId, "supervision-gate", "gateDecision")!.decision).toBe("BLOCK");

      await hook.postProcess!(ctx, makeResponse("modified B", [{ name: "y" }]));
      expect(store.get<{ decision: string }>(ctx.sessionId, "supervision-gate", "gateDecision")!.decision).toBe("ALLOW");
    });
  });

  // ─── postProcess — error handling ────────────────────────────────

  describe("postProcess — supervisor error handling", () => {
    it("treats supervisorFn throw as ALLOW (graceful degradation)", async () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({
        stateStore: store,
        supervisorFn: async () => { throw new Error("connection refused"); },
      });
      const ctx = makeCtx();

      await hook.postProcess!(ctx, makeResponse("modified x", [{ name: "x" }]));

      const stored = store.get<{ decision: string; reason: string }>(
        ctx.sessionId, "supervision-gate", "gateDecision",
      );
      expect(stored!.decision).toBe("ALLOW");
      expect(stored!.reason).toContain("connection refused");
    });

    it("treats empty supervisor response as ALLOW", async () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({
        stateStore: store,
        supervisorFn: async () => "",
      });
      const ctx = makeCtx();

      await hook.postProcess!(ctx, makeResponse("modified", [{ name: "x" }]));

      const stored = store.get<{ decision: string }>(ctx.sessionId, "supervision-gate", "gateDecision");
      expect(stored!.decision).toBe("ALLOW");
    });

    it("treats unknown format response as ALLOW with warning", async () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({
        stateStore: store,
        supervisorFn: async () => "maybe? I'm not sure",
      });
      const ctx = makeCtx();

      await hook.postProcess!(ctx, makeResponse("wrote to disk", [{ name: "x" }]));

      const stored = store.get<{ decision: string; reason: string }>(
        ctx.sessionId, "supervision-gate", "gateDecision",
      );
      expect(stored!.decision).toBe("ALLOW");
      expect(stored!.reason).toContain("unknown format");
    });
  });

  // ─── check() — enforcement behavior ──────────────────────────────

  describe("check — enforcement modes", () => {
    it("returns pass:true when no prior decision exists", () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({ stateStore: store });
      const result = hook.check(makeCtx()) as HookResult;
      expect(result.pass).toBe(true);
    });

    it("returns pass:true for ALLOW decision in any mode", async () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({
        stateStore: store,
        supervisorFn: async () => "ALLOW: ok",
      });
      const ctx = makeCtx({ profile: makeProfile("enforce") });

      await hook.postProcess!(ctx, makeResponse("modified", [{ name: "x" }]));
      const result = hook.check(ctx) as HookResult;

      expect(result.pass).toBe(true);
      expect(result.block).toBeUndefined();
    });

    it("blocks on BLOCK decision in enforce mode", async () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({
        stateStore: store,
        supervisorFn: async () => "BLOCK: unsafe",
      });
      const ctx = makeCtx({ profile: makeProfile("enforce") });

      await hook.postProcess!(ctx, makeResponse("deleted", [{ name: "rm" }]));
      const result = hook.check(ctx) as HookResult;

      expect(result.pass).toBe(false);
      expect(result.block).toBe(true);
      expect(result.reason).toContain("unsafe");
    });

    it("flags but does not block on BLOCK decision in log mode", async () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({
        stateStore: store,
        supervisorFn: async () => "BLOCK: risky",
      });
      const ctx = makeCtx({ profile: makeProfile("log") });

      await hook.postProcess!(ctx, makeResponse("deleted", [{ name: "rm" }]));
      const result = hook.check(ctx) as HookResult;

      expect(result.pass).toBe(true);
      expect(result.block).toBeUndefined();
      expect(result.flag).toContain("risky");
    });

    it("flags but does not block on BLOCK decision in advise mode", async () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({
        stateStore: store,
        supervisorFn: async () => "BLOCK: careful",
      });
      const ctx = makeCtx({ profile: makeProfile("advise") });

      await hook.postProcess!(ctx, makeResponse("deleted", [{ name: "rm" }]));
      const result = hook.check(ctx) as HookResult;

      expect(result.pass).toBe(true);
      expect(result.block).toBeUndefined();
      expect(result.flag).toContain("careful");
    });

    it("returns metadata with gate decision for ALLOW", async () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({
        stateStore: store,
        supervisorFn: async () => "ALLOW: approved",
      });
      const ctx = makeCtx();

      await hook.postProcess!(ctx, makeResponse("modified", [{ name: "x" }]));
      const result = hook.check(ctx) as HookResult;

      expect(result.metadata).toBeDefined();
      expect(result.metadata!.gateDecision).toBe("ALLOW");
      expect(result.metadata!.gateReason).toBe("approved");
    });
  });

  // ─── Session isolation ───────────────────────────────────────────

  describe("session isolation", () => {
    it("decisions from one session do not leak to another", async () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({
        stateStore: store,
        supervisorFn: async () => "BLOCK: nope",
      });

      const ctxA = makeCtx({ sessionId: "sess-A" });
      const ctxB = makeCtx({ sessionId: "sess-B" });

      await hook.postProcess!(ctxA, makeResponse("deleted stuff", [{ name: "rm" }]));

      // Session B has no decision
      const result = hook.check(ctxB) as HookResult;
      expect(result.pass).toBe(true);
      expect(result.block).toBeUndefined();
    });
  });

  // ─── Empty/missing response handling ─────────────────────────────

  describe("empty/missing response handling", () => {
    it("handles response with empty content and no toolCalls", async () => {
      const supervisorFn = vi.fn().mockResolvedValue("ALLOW: ok");
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({ stateStore: store, supervisorFn });
      const ctx = makeCtx();

      // Non-substantive — supervisor should not be called
      await hook.postProcess!(ctx, makeResponse(""));

      expect(supervisorFn).not.toHaveBeenCalled();
    });

    it("handles response with undefined content (coerced)", async () => {
      const store = new HookStateStore();
      const hook = createSupervisionGateHook({
        stateStore: store,
        supervisorFn: async () => "ALLOW: fine",
      });
      const ctx = makeCtx();

      // Force undefined content through
      await hook.postProcess!(ctx, { content: undefined as unknown as string, toolCalls: [{ name: "x" }] });

      const stored = store.get<{ decision: string }>(ctx.sessionId, "supervision-gate", "gateDecision");
      expect(stored!.decision).toBe("ALLOW");
    });
  });
});
