import { describe, it, expect, vi, beforeEach } from "vitest";
import { HookBus } from "@axiom-labs/arc-core";
import type {
  Hook,
  HookResult,
  EnforcementMode,
} from "../../packages/core/src/hooks/types.js";
import type { HookContext } from "../../packages/core/src/hooks/types.js";
import type { Profile } from "@axiom-labs/arc-core";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    message: "test message",
    sessionId: "sess-001",
    profile: {
      authType: "api-key",
      configDir: "/tmp/test",
      createdAt: "2026-01-01T00:00:00Z",
    } satisfies Profile,
    adapter: "test-adapter",
    ...overrides,
  };
}

function makeHook(overrides: Partial<Hook> & { name: string }): Hook {
  return {
    events: ["pre-message"],
    priority: 50,
    check: () => ({ pass: true }),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("HookBus", () => {
  let bus: HookBus;

  beforeEach(() => {
    bus = new HookBus();
  });

  // ── Register / unregister / list ─────────────────────────────────

  describe("register/unregister/list", () => {
    it("registers a hook and lists it", () => {
      const hook = makeHook({ name: "alpha" });
      bus.register(hook);
      expect(bus.list()).toHaveLength(1);
      expect(bus.list()[0].name).toBe("alpha");
    });

    it("replaces a hook with the same name", () => {
      bus.register(makeHook({ name: "alpha", priority: 10 }));
      bus.register(makeHook({ name: "alpha", priority: 20 }));
      expect(bus.list()).toHaveLength(1);
      expect(bus.list()[0].priority).toBe(20);
    });

    it("unregisters a hook by name", () => {
      bus.register(makeHook({ name: "alpha" }));
      expect(bus.unregister("alpha")).toBe(true);
      expect(bus.list()).toHaveLength(0);
    });

    it("returns false when unregistering a non-existent hook", () => {
      expect(bus.unregister("ghost")).toBe(false);
    });

    it("lists hooks sorted by priority ascending", () => {
      bus.register(makeHook({ name: "gamma", priority: 30 }));
      bus.register(makeHook({ name: "alpha", priority: 10 }));
      bus.register(makeHook({ name: "beta", priority: 20 }));
      const names = bus.list().map((h) => h.name);
      expect(names).toEqual(["alpha", "beta", "gamma"]);
    });
  });

  // ── Priority ordering ────────────────────────────────────────────

  describe("priority ordering", () => {
    it("runs hooks in priority order (ascending)", async () => {
      const order: string[] = [];

      bus.register(
        makeHook({
          name: "third",
          priority: 30,
          check: () => {
            order.push("third");
            return { pass: true };
          },
        })
      );
      bus.register(
        makeHook({
          name: "first",
          priority: 10,
          check: () => {
            order.push("first");
            return { pass: true };
          },
        })
      );
      bus.register(
        makeHook({
          name: "second",
          priority: 20,
          check: () => {
            order.push("second");
            return { pass: true };
          },
        })
      );

      await bus.runPre(makeCtx(), "log");
      expect(order).toEqual(["first", "second", "third"]);
    });
  });

  // ── Enforcement: off ─────────────────────────────────────────────

  describe("enforcement: off", () => {
    it("skips all hooks when enforcement is off", async () => {
      const checkFn = vi.fn(() => ({ pass: true }));
      bus.register(makeHook({ name: "should-not-run", check: checkFn }));

      const result = await bus.runPre(makeCtx(), "off");

      expect(checkFn).not.toHaveBeenCalled();
      expect(result.results).toHaveLength(0);
      expect(result.blocked).toBe(false);
    });
  });

  // ── Enforcement: log ─────────────────────────────────────────────

  describe("enforcement: log", () => {
    it("runs hooks but never blocks", async () => {
      bus.register(
        makeHook({
          name: "blocker",
          check: () => ({ pass: false, block: true, reason: "dangerous" }),
        })
      );

      const result = await bus.runPre(makeCtx(), "log");

      expect(result.results).toHaveLength(1);
      expect(result.results[0].block).toBe(true);
      expect(result.blocked).toBe(false); // log mode never blocks
    });

    it("continues to run all hooks even when one reports block", async () => {
      const order: string[] = [];

      bus.register(
        makeHook({
          name: "first",
          priority: 1,
          check: () => {
            order.push("first");
            return { pass: false, block: true };
          },
        })
      );
      bus.register(
        makeHook({
          name: "second",
          priority: 2,
          check: () => {
            order.push("second");
            return { pass: true };
          },
        })
      );

      await bus.runPre(makeCtx(), "log");
      expect(order).toEqual(["first", "second"]);
    });
  });

  // ── Enforcement: advise ──────────────────────────────────────────

  describe("enforcement: advise", () => {
    it("runs hooks and never blocks, even with block=true", async () => {
      bus.register(
        makeHook({
          name: "adviser",
          check: () => ({
            pass: false,
            block: true,
            flag: "risky operation",
            reason: "deploy detected",
          }),
        })
      );

      const result = await bus.runPre(makeCtx(), "advise");

      expect(result.blocked).toBe(false);
      expect(result.results[0].flag).toBe("risky operation");
    });
  });

  // ── Enforcement: enforce ─────────────────────────────────────────

  describe("enforcement: enforce", () => {
    it("blocks on HookResult.block=true", async () => {
      bus.register(
        makeHook({
          name: "blocker",
          check: () => ({
            pass: false,
            block: true,
            reason: "destructive command",
          }),
        })
      );

      const result = await bus.runPre(makeCtx(), "enforce");

      expect(result.blocked).toBe(true);
      expect(result.results).toHaveLength(1);
    });

    it("does not block when hooks pass", async () => {
      bus.register(
        makeHook({
          name: "safe",
          check: () => ({ pass: true }),
        })
      );

      const result = await bus.runPre(makeCtx(), "enforce");

      expect(result.blocked).toBe(false);
    });

    it("stops running further hooks after a block", async () => {
      const order: string[] = [];

      bus.register(
        makeHook({
          name: "blocker",
          priority: 1,
          check: () => {
            order.push("blocker");
            return { pass: false, block: true, reason: "stop" };
          },
        })
      );
      bus.register(
        makeHook({
          name: "never-reached",
          priority: 2,
          check: () => {
            order.push("never-reached");
            return { pass: true };
          },
        })
      );

      await bus.runPre(makeCtx(), "enforce");
      expect(order).toEqual(["blocker"]);
    });
  });

  // ── Timeout handling ─────────────────────────────────────────────

  describe("timeout handling", () => {
    it("times out a slow hook and treats it as failure", async () => {
      bus.register(
        makeHook({
          name: "slow-hook",
          check: () =>
            new Promise<HookResult>((resolve) => {
              setTimeout(() => resolve({ pass: true }), 10_000);
            }),
        }),
        { enabled: true, timeout: 50 } // 50ms timeout
      );

      const result = await bus.runPre(makeCtx(), "log");

      expect(result.results).toHaveLength(1);
      expect(result.results[0].pass).toBe(false);
      expect(result.results[0].reason).toContain("timed out");
    });

    it("timeout in enforce mode results in block", async () => {
      bus.register(
        makeHook({
          name: "slow-enforced",
          check: () =>
            new Promise<HookResult>((resolve) => {
              setTimeout(() => resolve({ pass: true }), 10_000);
            }),
        }),
        { enabled: true, timeout: 50 }
      );

      const result = await bus.runPre(makeCtx(), "enforce");

      expect(result.blocked).toBe(true);
      expect(result.results[0].block).toBe(true);
    });

    it("timeout in log mode does not block", async () => {
      bus.register(
        makeHook({
          name: "slow-logged",
          check: () =>
            new Promise<HookResult>((resolve) => {
              setTimeout(() => resolve({ pass: true }), 10_000);
            }),
        }),
        { enabled: true, timeout: 50 }
      );

      const result = await bus.runPre(makeCtx(), "log");

      expect(result.blocked).toBe(false);
    });
  });

  // ── Disabled hooks ───────────────────────────────────────────────

  describe("disabled hooks", () => {
    it("skips hooks with enabled=false in config", async () => {
      const checkFn = vi.fn(() => ({ pass: true }));
      bus.register(
        makeHook({ name: "disabled-hook", check: checkFn }),
        { enabled: false }
      );

      const result = await bus.runPre(makeCtx(), "enforce");

      expect(checkFn).not.toHaveBeenCalled();
      expect(result.results).toHaveLength(0);
    });
  });

  // ── Metadata merging ─────────────────────────────────────────────

  describe("metadata merging", () => {
    it("merges metadata from multiple hooks", async () => {
      bus.register(
        makeHook({
          name: "source",
          priority: 1,
          check: () => ({
            pass: true,
            metadata: { messageSource: "user" },
          }),
        })
      );
      bus.register(
        makeHook({
          name: "risk",
          priority: 10,
          check: () => ({
            pass: true,
            metadata: { riskTier: "read-only" },
          }),
        })
      );

      const result = await bus.runPre(makeCtx(), "log");

      expect(result.metadata).toEqual({
        messageSource: "user",
        riskTier: "read-only",
      });
    });

    it("inject() enriches context for downstream hooks", async () => {
      const seenSource: (string | undefined)[] = [];

      bus.register(
        makeHook({
          name: "source",
          priority: 1,
          check: () => ({ pass: true, metadata: { messageSource: "agent" } }),
          inject: () => ({ messageSource: "agent" }),
        })
      );
      bus.register(
        makeHook({
          name: "reader",
          priority: 10,
          check: (ctx) => {
            seenSource.push(ctx.hookMetadata?.messageSource as string | undefined);
            return { pass: true };
          },
        })
      );

      await bus.runPre(makeCtx(), "log");
      expect(seenSource[0]).toBe("agent");
    });
  });

  // ── Event filtering ──────────────────────────────────────────────

  describe("event filtering", () => {
    it("only runs hooks subscribed to the given event", async () => {
      const preMsgCheck = vi.fn(() => ({ pass: true }));
      const preLaunchCheck = vi.fn(() => ({ pass: true }));

      bus.register(
        makeHook({
          name: "pre-msg-only",
          events: ["pre-message"],
          check: preMsgCheck,
        })
      );
      bus.register(
        makeHook({
          name: "pre-launch-only",
          events: ["pre-launch"],
          check: preLaunchCheck,
        })
      );

      await bus.runPre(makeCtx(), "log", "pre-message");

      expect(preMsgCheck).toHaveBeenCalled();
      expect(preLaunchCheck).not.toHaveBeenCalled();
    });
  });

  // ── runPost ──────────────────────────────────────────────────────

  describe("runPost", () => {
    it("calls postProcess on hooks that have it", async () => {
      const postFn = vi.fn(async () => {});
      bus.register(
        makeHook({
          name: "post-hook",
          events: ["post-message"],
          postProcess: postFn,
        })
      );

      await bus.runPost(
        makeCtx(),
        { content: "response text" },
        "log",
        "post-message"
      );

      expect(postFn).toHaveBeenCalledOnce();
    });

    it("skips postProcess when enforcement is off", async () => {
      const postFn = vi.fn(async () => {});
      bus.register(
        makeHook({
          name: "post-hook",
          events: ["post-message"],
          postProcess: postFn,
        })
      );

      await bus.runPost(makeCtx(), { content: "x" }, "off");

      expect(postFn).not.toHaveBeenCalled();
    });

    it("continues after postProcess throws", async () => {
      const order: string[] = [];

      bus.register(
        makeHook({
          name: "throws",
          priority: 1,
          events: ["post-message"],
          postProcess: async () => {
            order.push("throws");
            throw new Error("boom");
          },
        })
      );
      bus.register(
        makeHook({
          name: "after-throw",
          priority: 2,
          events: ["post-message"],
          postProcess: async () => {
            order.push("after-throw");
          },
        })
      );

      await bus.runPost(makeCtx(), { content: "x" }, "log", "post-message");
      expect(order).toEqual(["throws", "after-throw"]);
    });
  });

  // ── Error handling ───────────────────────────────────────────────

  describe("error handling", () => {
    it("handles hooks that throw synchronously", async () => {
      bus.register(
        makeHook({
          name: "thrower",
          check: () => {
            throw new Error("sync boom");
          },
        })
      );

      const result = await bus.runPre(makeCtx(), "log");

      expect(result.results).toHaveLength(1);
      expect(result.results[0].pass).toBe(false);
      expect(result.results[0].reason).toContain("sync boom");
    });

    it("handles hooks that reject asynchronously", async () => {
      bus.register(
        makeHook({
          name: "rejecter",
          check: () => Promise.reject(new Error("async boom")),
        })
      );

      const result = await bus.runPre(makeCtx(), "log");

      expect(result.results).toHaveLength(1);
      expect(result.results[0].pass).toBe(false);
      expect(result.results[0].reason).toContain("async boom");
    });
  });
});
