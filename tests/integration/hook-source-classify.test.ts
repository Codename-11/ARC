import { describe, it, expect } from "vitest";
import { sourceClassifyHook } from "@axiom-labs/arc-core";
import type { HookContext, HookResult } from "../../packages/core/src/hooks/types.js";
import type { Profile } from "@axiom-labs/arc-core";

/** Helper — source-classify's check() is synchronous, cast for convenience. */
function check(ctx: HookContext): HookResult {
  return sourceClassifyHook.check(ctx) as HookResult;
}

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

// ─── Tests ───────────────────────────────────────────────────────────

describe("source-classify hook", () => {
  describe("check()", () => {
    it("classifies cron sessions from sessionId containing 'cron'", () => {
      const ctx = makeCtx({ sessionId: "cron-daily-cleanup" });
      const result = check(ctx);
      expect(result.pass).toBe(true);
      expect(result.metadata?.messageSource).toBe("cron");
    });

    it("classifies cron sessions from sessionId containing 'scheduled'", () => {
      const ctx = makeCtx({ sessionId: "scheduled-task-001" });
      const result = check(ctx);
      expect(result.pass).toBe(true);
      expect(result.metadata?.messageSource).toBe("cron");
    });

    it("classifies agent sessions from sessionId containing 'agent'", () => {
      const ctx = makeCtx({ sessionId: "agent-worker-7" });
      const result = check(ctx);
      expect(result.pass).toBe(true);
      expect(result.metadata?.messageSource).toBe("agent");
    });

    it("classifies agent sessions from sessionId containing 'auto'", () => {
      const ctx = makeCtx({ sessionId: "auto-mode-session-3" });
      const result = check(ctx);
      expect(result.pass).toBe(true);
      expect(result.metadata?.messageSource).toBe("agent");
    });

    it("classifies system from adapter name 'system'", () => {
      const ctx = makeCtx({ adapter: "system", sessionId: "internal-001" });
      const result = check(ctx);
      expect(result.pass).toBe(true);
      expect(result.metadata?.messageSource).toBe("system");
    });

    it("classifies system from sessionId starting with 'system-'", () => {
      const ctx = makeCtx({ sessionId: "system-healthcheck" });
      const result = check(ctx);
      expect(result.pass).toBe(true);
      expect(result.metadata?.messageSource).toBe("system");
    });

    it("classifies user for known interactive adapters", () => {
      for (const adapter of ["claude", "codex", "openclaw", "generic"]) {
        const ctx = makeCtx({ adapter, sessionId: "user-session-42" });
        const result = check(ctx);
        expect(result.pass).toBe(true);
        expect(result.metadata?.messageSource).toBe("user");
      }
    });

    it("classifies unknown for unrecognized adapter and sessionId", () => {
      const ctx = makeCtx({ adapter: "custom-tool", sessionId: "random-session" });
      const result = check(ctx);
      expect(result.pass).toBe(true);
      expect(result.metadata?.messageSource).toBe("unknown");
    });

    it("is case-insensitive for sessionId patterns", () => {
      const ctx = makeCtx({ sessionId: "CRON-NIGHTLY" });
      const result = check(ctx);
      expect(result.metadata?.messageSource).toBe("cron");
    });

    it("is case-insensitive for adapter names", () => {
      const ctx = makeCtx({ adapter: "Claude", sessionId: "user-1" });
      const result = check(ctx);
      expect(result.metadata?.messageSource).toBe("user");
    });

    it("always returns pass=true (source-classify never blocks)", () => {
      const contexts = [
        makeCtx({ sessionId: "cron-x" }),
        makeCtx({ sessionId: "agent-x" }),
        makeCtx({ adapter: "system" }),
        makeCtx({ adapter: "claude" }),
        makeCtx({ adapter: "unknown-thing" }),
      ];
      for (const ctx of contexts) {
        expect(check(ctx).pass).toBe(true);
      }
    });
  });

  describe("inject()", () => {
    it("sets ctx.source and returns messageSource metadata", () => {
      const ctx = makeCtx({ adapter: "claude", sessionId: "user-1" });
      const metadata = sourceClassifyHook.inject!(ctx);
      expect(ctx.source).toBe("user");
      expect(metadata).toEqual({ messageSource: "user" });
    });

    it("enriches ctx.source for downstream hooks", () => {
      const ctx = makeCtx({ sessionId: "cron-job" });
      sourceClassifyHook.inject!(ctx);
      expect(ctx.source).toBe("cron");
    });
  });

  describe("priority ordering", () => {
    it("cron takes precedence over agent when sessionId has both", () => {
      // "cron" check comes before "agent" in the logic
      const ctx = makeCtx({ sessionId: "cron-agent-hybrid" });
      const result = check(ctx);
      expect(result.metadata?.messageSource).toBe("cron");
    });

    it("agent takes precedence over system", () => {
      const ctx = makeCtx({ sessionId: "agent-system-bridge", adapter: "system" });
      const result = check(ctx);
      expect(result.metadata?.messageSource).toBe("agent");
    });
  });

  describe("hook metadata", () => {
    it("has name 'source-classify'", () => {
      expect(sourceClassifyHook.name).toBe("source-classify");
    });

    it("subscribes to pre-message and pre-launch events", () => {
      expect(sourceClassifyHook.events).toEqual(["pre-message", "pre-launch"]);
    });

    it("has priority 1 (runs first)", () => {
      expect(sourceClassifyHook.priority).toBe(1);
    });
  });
});
