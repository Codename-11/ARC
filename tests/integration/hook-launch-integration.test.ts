import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDefaultHookBus } from "../../packages/core/src/hooks/create-default-bus.js";
import type { HookContext, EnforcementMode, HookConfig } from "../../packages/core/src/hooks/types.js";
import type { Profile } from "../../packages/core/src/types.js";
import * as loggingModule from "../../packages/core/src/logging.js";

// Type alias for mock call args
type MockCallArgs = unknown[];

// ─── Helpers ─────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    authType: "api-key",
    configDir: "/tmp/test",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    message: "list all files in the project",
    sessionId: "launch-default-1234567890",
    profile: makeProfile(),
    adapter: "claude",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("Hook Launch Integration", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(loggingModule, "writeLogEvent").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── createDefaultHookBus wiring ──────────────────────────────────

  describe("createDefaultHookBus", () => {
    it("registers source-classify and risk-detection hooks", () => {
      const bus = createDefaultHookBus();
      const hooks = bus.list();

      expect(hooks).toHaveLength(7);
      expect(hooks[0].name).toBe("source-classify");
      expect(hooks[0].priority).toBe(1);
      expect(hooks[1].name).toBe("interagent-routing");
      expect(hooks[1].priority).toBe(2);
      expect(hooks[2].name).toBe("risk-detection");
      expect(hooks[2].priority).toBe(10);
      expect(hooks[3].name).toBe("attempt-tracker");
      expect(hooks[3].priority).toBe(20);
      expect(hooks[4].name).toBe("audit-score");
      expect(hooks[4].priority).toBe(90);
      expect(hooks[5].name).toBe("supervision-gate");
      expect(hooks[5].priority).toBe(92);
      expect(hooks[6].name).toBe("post-verify");
      expect(hooks[6].priority).toBe(95);
    });

    it("applies per-hook config when provided", () => {
      const hookConfigs: Record<string, HookConfig> = {
        "source-classify": { enabled: false },
        "risk-detection": { enabled: true, timeout: 3000 },
      };
      const bus = createDefaultHookBus(hookConfigs);
      const hooks = bus.list();

      // Both hooks are registered — the bus stores config separately
      expect(hooks).toHaveLength(7);
    });

    it("returns a new bus instance each call", () => {
      const bus1 = createDefaultHookBus();
      const bus2 = createDefaultHookBus();
      expect(bus1).not.toBe(bus2);
    });
  });

  // ── Pre-launch pipeline (only source-classify subscribes) ────────

  describe("pre-launch pipeline with enforcement=log", () => {
    it("runs source-classify and does not block on safe message", async () => {
      const bus = createDefaultHookBus();
      const ctx = makeCtx({ message: "list all files" });

      const result = await bus.runPre(ctx, "log", "pre-launch");

      expect(result.blocked).toBe(false);
      // Only source-classify subscribes to pre-launch
      expect(result.results).toHaveLength(1);
      expect(result.results[0].pass).toBe(true);
      expect(result.metadata).toHaveProperty("messageSource");
    });

    it("produces structured log events for source-classify at pre-launch", async () => {
      const bus = createDefaultHookBus();
      const ctx = makeCtx();

      await bus.runPre(ctx, "log", "pre-launch");

      const hookBusCalls = logSpy.mock.calls.filter(
        (call: MockCallArgs) => (call[0] as loggingModule.LogEvent).component === "hook-bus"
      );
      expect(hookBusCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Pre-message pipeline (both hooks subscribe) ──────────────────

  describe("pre-message pipeline with enforcement=enforce", () => {
    it("blocks on destructive message in enforce mode", async () => {
      const bus = createDefaultHookBus();
      const ctx = makeCtx({
        message: "run rm -rf /var/data and drop database production",
        profile: makeProfile({ enforcement: "enforce" }),
      });

      const result = await bus.runPre(ctx, "enforce", "pre-message");

      expect(result.blocked).toBe(true);
      const blockingResult = result.results.find((r) => r.block === true);
      expect(blockingResult).toBeDefined();
      expect(blockingResult!.pass).toBe(false);
    });

    it("does not block on safe message in enforce mode", async () => {
      const bus = createDefaultHookBus();
      const ctx = makeCtx({
        message: "show me the current git status",
        profile: makeProfile({ enforcement: "enforce" }),
      });

      const result = await bus.runPre(ctx, "enforce", "pre-message");

      expect(result.blocked).toBe(false);
      expect(result.results.every((r) => r.pass === true)).toBe(true);
    });

    it("logs block event when pipeline is blocked", async () => {
      const bus = createDefaultHookBus();
      const ctx = makeCtx({
        message: "run rm -rf /var/data and drop database production",
        profile: makeProfile({ enforcement: "enforce" }),
      });

      await bus.runPre(ctx, "enforce", "pre-message");

      const blockLogs = logSpy.mock.calls.filter(
        (call: MockCallArgs) => {
          const event = call[0] as loggingModule.LogEvent;
          return event.component === "hook-bus" && event.action === "hook:block";
        }
      );
      expect(blockLogs.length).toBeGreaterThanOrEqual(1);
    });

    it("runs hooks on dangerous message without blocking in log mode", async () => {
      const bus = createDefaultHookBus();
      const ctx = makeCtx({
        message: "drop database production",
        profile: makeProfile({ enforcement: "log" }),
      });

      const result = await bus.runPre(ctx, "log", "pre-message");

      expect(result.blocked).toBe(false);
      // risk-detection should flag but not block
      const riskResult = result.results.find((r) => r.tier !== undefined);
      expect(riskResult).toBeDefined();
      expect(riskResult!.pass).toBe(true); // pass=true in log mode
    });
  });

  // ── Pre-message pipeline (enforcement=off) ───────────────────────

  describe("pre-message pipeline with enforcement=off", () => {
    it("skips all hooks when enforcement is off", async () => {
      const bus = createDefaultHookBus();
      const ctx = makeCtx({
        message: "delete everything",
        profile: makeProfile({ enforcement: "off" }),
      });

      const result = await bus.runPre(ctx, "off", "pre-message");

      expect(result.blocked).toBe(false);
      expect(result.results).toHaveLength(0);
    });
  });

  // ── Pre-message pipeline (enforcement=advise) ────────────────────

  describe("pre-message pipeline with enforcement=advise", () => {
    it("flags dangerous messages without blocking in advise mode", async () => {
      const bus = createDefaultHookBus();
      const ctx = makeCtx({
        message: "drop database production",
        profile: makeProfile({ enforcement: "advise" }),
      });

      const result = await bus.runPre(ctx, "advise", "pre-message");

      expect(result.blocked).toBe(false);
      // risk-detection ran and produced a risk tier
      const riskResult = result.results.find((r) => r.tier !== undefined);
      expect(riskResult).toBeDefined();
    });
  });

  // ── Hook config integration ──────────────────────────────────────

  describe("per-hook config", () => {
    it("skips disabled hooks", async () => {
      const bus = createDefaultHookBus({
        "risk-detection": { enabled: false },
      });
      const ctx = makeCtx({
        message: "run rm -rf /var/data",
        profile: makeProfile({ enforcement: "enforce" }),
      });

      const result = await bus.runPre(ctx, "enforce", "pre-message");

      // risk-detection is disabled, so no blocking even on destructive message
      expect(result.blocked).toBe(false);
      // Only source-classify should have run
      const riskResults = result.results.filter((r) => r.tier !== undefined);
      expect(riskResults).toHaveLength(0);
    });

    it("applies custom timeout to hooks", async () => {
      const bus = createDefaultHookBus({
        "source-classify": { enabled: true, timeout: 100 },
        "risk-detection": { enabled: true, timeout: 100 },
      });
      const ctx = makeCtx();

      // With 100ms timeout, normal hooks should still finish in time
      const result = await bus.runPre(ctx, "log", "pre-message");

      expect(result.results.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Metadata propagation ─────────────────────────────────────────

  describe("metadata propagation", () => {
    it("source-classify injects messageSource into metadata", async () => {
      const bus = createDefaultHookBus();
      const ctx = makeCtx({ adapter: "claude" });

      const result = await bus.runPre(ctx, "log", "pre-launch");

      expect(result.metadata.messageSource).toBe("user");
    });

    it("risk-detection injects riskTier into metadata via pre-message", async () => {
      const bus = createDefaultHookBus();
      const ctx = makeCtx({
        message: "drop database staging",
        profile: makeProfile({ enforcement: "log" }),
      });

      const result = await bus.runPre(ctx, "log", "pre-message");

      expect(result.metadata).toHaveProperty("riskTier");
    });

    it("hooks run in priority order: source-classify before risk-detection", async () => {
      const bus = createDefaultHookBus();
      const executionOrder: string[] = [];

      // Spy on writeLogEvent to track execution order
      logSpy.mockImplementation((event: any) => {
        if (event.action === "hook:check" && event.data?.hook) {
          executionOrder.push(event.data.hook as string);
        }
      });

      const ctx = makeCtx();
      await bus.runPre(ctx, "log", "pre-message");

      expect(executionOrder).toEqual(["source-classify", "interagent-routing", "risk-detection"]);
    });
  });

  // ── Structured log event format ──────────────────────────────────

  describe("structured log events", () => {
    it("log events include required fields", async () => {
      const bus = createDefaultHookBus();
      const ctx = makeCtx();

      await bus.runPre(ctx, "log", "pre-message");

      const hookCheckCalls = logSpy.mock.calls.filter(
        (call: MockCallArgs) => {
          const event = call[0] as loggingModule.LogEvent;
          return event.component === "hook-bus" && event.action === "hook:check";
        }
      );

      expect(hookCheckCalls.length).toBeGreaterThanOrEqual(2);

      for (const call of hookCheckCalls) {
        const event = call[0] as loggingModule.LogEvent;
        expect(event.level).toBeDefined();
        expect(event.component).toBe("hook-bus");
        expect(event.action).toBe("hook:check");
        expect(event.data).toBeDefined();
        expect(event.data!.hook).toBeDefined();
        expect(event.data!.priority).toBeDefined();
        expect(event.data!.enforcement).toBeDefined();
        expect(event.data!.durationMs).toBeDefined();
      }
    });

    it("source-classify emits classify log event", async () => {
      const bus = createDefaultHookBus();
      const ctx = makeCtx();

      await bus.runPre(ctx, "log", "pre-launch");

      const classifyCalls = logSpy.mock.calls.filter(
        (call: MockCallArgs) => {
          const event = call[0] as loggingModule.LogEvent;
          return event.component === "hook:source-classify" && event.action === "classify";
        }
      );
      expect(classifyCalls.length).toBeGreaterThanOrEqual(1);
    });

    it("risk-detection emits classify log event on pre-message", async () => {
      const bus = createDefaultHookBus();
      const ctx = makeCtx({ message: "drop database test" });

      await bus.runPre(ctx, "log", "pre-message");

      const riskCalls = logSpy.mock.calls.filter(
        (call: MockCallArgs) => {
          const event = call[0] as loggingModule.LogEvent;
          return event.component === "hook:risk-detection" && event.action === "classify";
        }
      );
      expect(riskCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Event filtering ──────────────────────────────────────────────

  describe("event filtering", () => {
    it("source-classify runs on both pre-launch and pre-message", async () => {
      const bus = createDefaultHookBus();
      const ctx = makeCtx();

      const preLaunch = await bus.runPre(ctx, "log", "pre-launch");
      expect(preLaunch.metadata).toHaveProperty("messageSource");

      const preMessage = await bus.runPre(ctx, "log", "pre-message");
      expect(preMessage.metadata).toHaveProperty("messageSource");
    });

    it("risk-detection only runs on pre-message, not pre-launch", async () => {
      const bus = createDefaultHookBus();
      const ctx = makeCtx({
        message: "run rm -rf /tmp and drop database test",
        profile: makeProfile({ enforcement: "enforce" }),
      });

      // Pre-launch: only source-classify fires
      const preLaunchResult = await bus.runPre(ctx, "enforce", "pre-launch");
      expect(preLaunchResult.blocked).toBe(false);
      expect(preLaunchResult.results).toHaveLength(1); // only source-classify

      // Pre-message: both hooks fire, risk-detection blocks
      const preMessageResult = await bus.runPre(ctx, "enforce", "pre-message");
      expect(preMessageResult.blocked).toBe(true);
      expect(preMessageResult.results.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── handleLaunch wiring simulation ───────────────────────────────
  // These test the same logic path handleLaunch uses: create bus, run pre-launch, check blocked.

  describe("handleLaunch hook integration", () => {
    it("simulates handleLaunch enforcement=log path — hooks run, launch proceeds", async () => {
      const profile = makeProfile({ enforcement: "log" });
      const bus = createDefaultHookBus(profile.hooks);
      const ctx: HookContext = {
        message: "",
        sessionId: `launch-default-${Date.now()}`,
        profile,
        adapter: "claude",
      };

      const hookResult = await bus.runPre(ctx, profile.enforcement ?? "log", "pre-launch");

      // In log mode, never blocked
      expect(hookResult.blocked).toBe(false);
      // Source classify ran
      expect(hookResult.metadata).toHaveProperty("messageSource");
    });

    it("simulates handleLaunch enforcement=enforce path — safe profile proceeds", async () => {
      const profile = makeProfile({ enforcement: "enforce" });
      const bus = createDefaultHookBus(profile.hooks);
      const ctx: HookContext = {
        message: "",
        sessionId: `launch-default-${Date.now()}`,
        profile,
        adapter: "claude",
      };

      const hookResult = await bus.runPre(ctx, "enforce", "pre-launch");

      // Source classify passes — no blocking at pre-launch for empty message
      expect(hookResult.blocked).toBe(false);
    });

    it("simulates handleLaunch with disabled hooks in profile config", async () => {
      const profile = makeProfile({
        enforcement: "log",
        hooks: { "source-classify": { enabled: false } },
      });
      const bus = createDefaultHookBus(profile.hooks);
      const ctx: HookContext = {
        message: "",
        sessionId: `launch-default-${Date.now()}`,
        profile,
        adapter: "claude",
      };

      const hookResult = await bus.runPre(ctx, "log", "pre-launch");

      // source-classify disabled, no metadata
      expect(hookResult.metadata.messageSource).toBeUndefined();
    });

    it("simulates handleLaunch with enforcement=off — no hooks run", async () => {
      const profile = makeProfile({ enforcement: "off" });
      const bus = createDefaultHookBus(profile.hooks);

      const hookResult = await bus.runPre(
        makeCtx({ profile }),
        "off",
        "pre-launch"
      );

      expect(hookResult.results).toHaveLength(0);
      expect(hookResult.blocked).toBe(false);
    });
  });
});
