import { describe, it, expect } from "vitest";
import { classifyRisk, riskDetectionHook } from "@axiom-labs/arc-core";
import type { HookContext, HookResult } from "../../packages/core/src/hooks/types.js";
import type { Profile } from "@axiom-labs/arc-core";

// ─── Helpers ─────────────────────────────────────────────────────────

/** risk-detection's check() is synchronous, cast for convenience. */
function checkRisk(ctx: HookContext): HookResult {
  return riskDetectionHook.check(ctx) as HookResult;
}

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

// ─── classifyRisk() pure function ────────────────────────────────────

describe("classifyRisk()", () => {
  describe("destructive tier", () => {
    it("matches 'force push'", () => {
      const r = classifyRisk("please force push to origin");
      expect(r.tier).toBe("destructive");
      expect(r.requiresConfirmation).toBe(true);
      expect(r.checklistIntensity).toBe("strict");
    });

    it("matches 'rm -rf'", () => {
      const r = classifyRisk("run rm -rf /tmp/build");
      expect(r.tier).toBe("destructive");
    });

    it("matches 'drop table'", () => {
      const r = classifyRisk("drop table users");
      expect(r.tier).toBe("destructive");
    });

    it("matches 'reset --hard'", () => {
      const r = classifyRisk("git reset --hard HEAD~3");
      expect(r.tier).toBe("destructive");
    });

    it("matches 'delete branch'", () => {
      const r = classifyRisk("delete branch feature-old");
      expect(r.tier).toBe("destructive");
    });

    it("matches 'truncate table'", () => {
      const r = classifyRisk("truncate table logs");
      expect(r.tier).toBe("destructive");
    });
  });

  describe("deploy-affecting tier", () => {
    it("matches standalone 'deploy'", () => {
      const r = classifyRisk("deploy the app to staging");
      expect(r.tier).toBe("deploy-affecting");
      expect(r.requiresConfirmation).toBe(true);
      expect(r.checklistIntensity).toBe("strict");
    });

    it("matches 'release'", () => {
      const r = classifyRisk("release version 2.0");
      expect(r.tier).toBe("deploy-affecting");
    });

    it("matches 'publish'", () => {
      const r = classifyRisk("publish the npm package");
      expect(r.tier).toBe("deploy-affecting");
    });

    it("matches 'merge to main'", () => {
      const r = classifyRisk("merge to main when ready");
      expect(r.tier).toBe("deploy-affecting");
    });

    it("matches 'push to production'", () => {
      const r = classifyRisk("push to production now");
      expect(r.tier).toBe("deploy-affecting");
    });
  });

  describe("build-affecting tier", () => {
    it("matches 'npm install'", () => {
      const r = classifyRisk("npm install lodash");
      expect(r.tier).toBe("build-affecting");
      expect(r.requiresConfirmation).toBe(false);
      expect(r.checklistIntensity).toBe("standard");
    });

    it("matches 'dockerfile'", () => {
      const r = classifyRisk("update the dockerfile");
      expect(r.tier).toBe("build-affecting");
    });

    it("matches 'tsconfig'", () => {
      const r = classifyRisk("modify tsconfig paths");
      expect(r.tier).toBe("build-affecting");
    });

    it("matches 'docker build'", () => {
      const r = classifyRisk("docker build -t myapp .");
      expect(r.tier).toBe("build-affecting");
    });

    it("matches 'yarn add'", () => {
      const r = classifyRisk("yarn add express");
      expect(r.tier).toBe("build-affecting");
    });
  });

  describe("file-modification tier", () => {
    it("matches 'edit'", () => {
      const r = classifyRisk("edit the config file");
      expect(r.tier).toBe("file-modification");
      expect(r.requiresConfirmation).toBe(false);
      expect(r.checklistIntensity).toBe("standard");
    });

    it("matches 'refactor'", () => {
      const r = classifyRisk("refactor the auth module");
      expect(r.tier).toBe("file-modification");
    });

    it("matches 'create'", () => {
      const r = classifyRisk("create a new component");
      expect(r.tier).toBe("file-modification");
    });
  });

  describe("read-only tier", () => {
    it("matches 'explain'", () => {
      const r = classifyRisk("explain how hooks work");
      expect(r.tier).toBe("read-only");
      expect(r.requiresConfirmation).toBe(false);
      expect(r.checklistIntensity).toBe("light");
    });

    it("matches 'search'", () => {
      const r = classifyRisk("search for all test files");
      expect(r.tier).toBe("read-only");
    });

    it("matches 'list'", () => {
      const r = classifyRisk("list all adapters");
      expect(r.tier).toBe("read-only");
    });

    it("matches 'show'", () => {
      const r = classifyRisk("show the current config");
      expect(r.tier).toBe("read-only");
    });
  });

  describe("word-boundary matching (Axiom-Supervisor improvement)", () => {
    it("does NOT flag 'explain the deployment' as deploy-affecting", () => {
      // "deployment" is not the keyword "deploy" at word boundary
      const r = classifyRisk("explain the deployment process");
      // Should be read-only because "explain" matches, and "deployment" != "deploy"
      expect(r.tier).toBe("read-only");
      expect(r.reasons.some((r) => r.includes("deploy"))).toBe(false);
    });

    it("DOES flag 'deploy the app' as deploy-affecting", () => {
      const r = classifyRisk("deploy the app to staging");
      expect(r.tier).toBe("deploy-affecting");
    });

    it("does NOT flag 'editorial' as 'edit'", () => {
      const r = classifyRisk("the editorial team reviewed it");
      // "editorial" should not match "edit" at word boundary
      expect(r.reasons.every((r) => !r.includes("[file-modification] edit"))).toBe(true);
    });

    it("does NOT flag 'searchable' as 'search'", () => {
      const r = classifyRisk("make the content searchable");
      // "searchable" should not match "search" at word boundary
      expect(r.reasons.every((r) => !r.includes("[read-only] search"))).toBe(true);
    });

    it("does NOT flag 'explained' as 'explain'", () => {
      // Actually "explained" does contain "explain" at a word boundary (explain|ed)
      // because \bexplain\b matches "explain" in "explained"? No — "explained" has
      // no boundary between "explain" and "ed". Let's verify.
      const r = classifyRisk("I explained the architecture");
      // \bexplain\b should NOT match "explained" because there's no boundary after "explain"
      expect(r.reasons.every((r) => !r.includes("[read-only] explain"))).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("returns read-only for empty string", () => {
      const r = classifyRisk("");
      expect(r.tier).toBe("read-only");
      expect(r.reasons).toContain("empty or whitespace-only message");
    });

    it("returns read-only for whitespace-only string", () => {
      const r = classifyRisk("   \n\t  ");
      expect(r.tier).toBe("read-only");
    });

    it("returns read-only for no keyword matches", () => {
      const r = classifyRisk("hello world");
      expect(r.tier).toBe("read-only");
      expect(r.reasons).toContain("no keyword matches — defaulting to read-only");
    });

    it("returns highest tier when message contains mixed signals", () => {
      // "deploy" (deploy-affecting) + "edit" (file-modification)
      const r = classifyRisk("edit the deploy script");
      expect(r.tier).toBe("deploy-affecting");
    });

    it("collects reasons from multiple tiers", () => {
      const r = classifyRisk("deploy the app and edit the config");
      expect(r.tier).toBe("deploy-affecting");
      // Should have reasons from both deploy-affecting and file-modification
      expect(r.reasons.some((r) => r.includes("[deploy-affecting]"))).toBe(true);
      expect(r.reasons.some((r) => r.includes("[file-modification]"))).toBe(true);
    });

    it("handles case-insensitive matching", () => {
      const r = classifyRisk("FORCE PUSH to origin");
      expect(r.tier).toBe("destructive");
    });
  });
});

// ─── riskDetectionHook (Hook wrapper) ────────────────────────────────

describe("risk-detection hook", () => {
  describe("hook metadata", () => {
    it("has name 'risk-detection'", () => {
      expect(riskDetectionHook.name).toBe("risk-detection");
    });

    it("subscribes to pre-message only", () => {
      expect(riskDetectionHook.events).toEqual(["pre-message"]);
    });

    it("has priority 10", () => {
      expect(riskDetectionHook.priority).toBe(10);
    });
  });

  describe("check()", () => {
    it("returns pass=true for read-only messages", () => {
      const ctx = makeCtx({ message: "explain how hooks work" });
      const result = checkRisk(ctx);
      expect(result.pass).toBe(true);
      expect(result.block).toBeFalsy();
      expect(result.metadata?.riskTier).toBe("read-only");
    });

    it("returns pass=true and no block for deploy-affecting in log mode", () => {
      const ctx = makeCtx({
        message: "deploy to staging",
        profile: {
          authType: "api-key",
          configDir: "/tmp/test",
          createdAt: "2026-01-01T00:00:00Z",
          enforcement: "log",
        },
      });
      const result = checkRisk(ctx);
      expect(result.pass).toBe(true);
      expect(result.block).toBeFalsy();
      expect(result.flag).toBeTruthy();
    });

    it("blocks deploy-affecting messages in enforce mode", () => {
      const ctx = makeCtx({
        message: "deploy to staging",
        profile: {
          authType: "api-key",
          configDir: "/tmp/test",
          createdAt: "2026-01-01T00:00:00Z",
          enforcement: "enforce",
        },
      });
      const result = checkRisk(ctx);
      expect(result.pass).toBe(false);
      expect(result.block).toBe(true);
      expect(result.reason).toContain("deploy-affecting");
    });

    it("blocks destructive messages in enforce mode", () => {
      const ctx = makeCtx({
        message: "force push to main",
        profile: {
          authType: "api-key",
          configDir: "/tmp/test",
          createdAt: "2026-01-01T00:00:00Z",
          enforcement: "enforce",
        },
      });
      const result = checkRisk(ctx);
      expect(result.pass).toBe(false);
      expect(result.block).toBe(true);
    });

    it("does not block file-modification in enforce mode", () => {
      const ctx = makeCtx({
        message: "edit the config file",
        profile: {
          authType: "api-key",
          configDir: "/tmp/test",
          createdAt: "2026-01-01T00:00:00Z",
          enforcement: "enforce",
        },
      });
      const result = checkRisk(ctx);
      expect(result.pass).toBe(true);
      expect(result.block).toBeFalsy();
    });

    it("populates risk metadata in result", () => {
      const ctx = makeCtx({ message: "npm install express" });
      const result = checkRisk(ctx);
      expect(result.metadata).toMatchObject({
        riskTier: "build-affecting",
        requiresConfirmation: false,
        checklistIntensity: "standard",
      });
      expect(Array.isArray(result.metadata?.riskReasons)).toBe(true);
    });

    it("defaults enforcement to 'log' when not set on profile", () => {
      const ctx = makeCtx({ message: "deploy to staging" });
      // No enforcement on profile → defaults to "log" → no block
      const result = checkRisk(ctx);
      expect(result.pass).toBe(true);
      expect(result.block).toBeFalsy();
    });
  });

  describe("inject()", () => {
    it("sets ctx.riskTier and returns risk metadata", () => {
      const ctx = makeCtx({ message: "refactor the auth module" });
      const metadata = riskDetectionHook.inject!(ctx);
      expect(ctx.riskTier).toBe("file-modification");
      expect(metadata).toMatchObject({
        riskTier: "file-modification",
        requiresConfirmation: false,
      });
    });
  });
});
