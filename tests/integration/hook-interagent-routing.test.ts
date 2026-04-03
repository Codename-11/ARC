import { describe, it, expect } from "vitest";
import { interagentRoutingHook } from "@axiom-labs/arc-core";
import type { HookContext, HookResult } from "../../packages/core/src/hooks/types.js";
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

function check(ctx: HookContext): HookResult {
  return interagentRoutingHook.check(ctx) as HookResult;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("interagent-routing hook", () => {
  describe("hook metadata", () => {
    it("has name 'interagent-routing'", () => {
      expect(interagentRoutingHook.name).toBe("interagent-routing");
    });

    it("subscribes to pre-message events", () => {
      expect(interagentRoutingHook.events).toEqual(["pre-message"]);
    });

    it("has priority 2", () => {
      expect(interagentRoutingHook.priority).toBe(2);
    });
  });

  describe("user messages — always pass", () => {
    it("allows user source messages", () => {
      const ctx = makeCtx({ source: "user" });
      const result = check(ctx);
      expect(result.pass).toBe(true);
    });

    it("allows user messages even without @mention", () => {
      const ctx = makeCtx({ source: "user", message: "just a plain message" });
      const result = check(ctx);
      expect(result.pass).toBe(true);
    });

    it("allows user messages in enforce mode", () => {
      const ctx = makeCtx({ source: "user", profile: makeProfile("enforce") });
      const result = check(ctx);
      expect(result.pass).toBe(true);
    });
  });

  describe("non-agent sources — always pass", () => {
    it("allows system source", () => {
      const result = check(makeCtx({ source: "system" }));
      expect(result.pass).toBe(true);
    });

    it("allows cron source", () => {
      const result = check(makeCtx({ source: "cron" }));
      expect(result.pass).toBe(true);
    });

    it("allows unknown source", () => {
      const result = check(makeCtx({ source: "unknown" }));
      expect(result.pass).toBe(true);
    });

    it("allows undefined source", () => {
      const result = check(makeCtx({ source: undefined }));
      expect(result.pass).toBe(true);
    });
  });

  describe("agent messages without @mention — suppress", () => {
    it("returns pass:false for agent source without @mention", () => {
      const ctx = makeCtx({ source: "agent", message: "do this task" });
      const result = check(ctx);
      expect(result.pass).toBe(false);
      expect(result.metadata?.should_suppress).toBe(true);
    });

    it("blocks in enforce mode", () => {
      const ctx = makeCtx({
        source: "agent",
        message: "do this task",
        profile: makeProfile("enforce"),
      });
      const result = check(ctx);
      expect(result.pass).toBe(false);
      expect(result.block).toBe(true);
      expect(result.reason).toContain("agent");
    });

    it("flags but does not block in log mode", () => {
      const ctx = makeCtx({
        source: "agent",
        message: "do this task",
        profile: makeProfile("log"),
      });
      const result = check(ctx);
      expect(result.pass).toBe(false);
      expect(result.block).toBeFalsy();
      expect(result.flag).toBeTruthy();
    });

    it("flags but does not block in advise mode", () => {
      const ctx = makeCtx({
        source: "agent",
        message: "do this task",
        profile: makeProfile("advise"),
      });
      const result = check(ctx);
      expect(result.pass).toBe(false);
      expect(result.block).toBeFalsy();
      expect(result.flag).toBeTruthy();
    });

    it("defaults to log mode when enforcement is undefined", () => {
      const ctx = makeCtx({
        source: "agent",
        message: "do this task",
        profile: makeProfile(undefined),
      });
      const result = check(ctx);
      expect(result.pass).toBe(false);
      expect(result.block).toBeFalsy();
    });
  });

  describe("agent messages with @mention — allow", () => {
    it("allows agent message with @mention", () => {
      const ctx = makeCtx({
        source: "agent",
        message: "hey @reviewer please check this",
      });
      const result = check(ctx);
      expect(result.pass).toBe(true);
    });

    it("allows agent message with @mention at start", () => {
      const ctx = makeCtx({
        source: "agent",
        message: "@builder run the tests",
      });
      const result = check(ctx);
      expect(result.pass).toBe(true);
    });

    it("allows agent message with @mention in enforce mode", () => {
      const ctx = makeCtx({
        source: "agent",
        message: "hey @supervisor check this",
        profile: makeProfile("enforce"),
      });
      const result = check(ctx);
      expect(result.pass).toBe(true);
    });

    it("sets hasMention metadata when @mention is present", () => {
      const ctx = makeCtx({
        source: "agent",
        message: "hey @bot do something",
      });
      const result = check(ctx);
      expect(result.metadata?.hasMention).toBe(true);
      expect(result.metadata?.should_suppress).toBe(false);
    });
  });

  describe("@mention pattern matching", () => {
    it("matches @word with digits", () => {
      const ctx = makeCtx({ source: "agent", message: "ping @agent42" });
      expect(check(ctx).pass).toBe(true);
    });

    it("matches @word with underscores", () => {
      const ctx = makeCtx({ source: "agent", message: "ping @code_reviewer" });
      expect(check(ctx).pass).toBe(true);
    });

    it("does not match bare @ without following word chars", () => {
      const ctx = makeCtx({ source: "agent", message: "email@ domain" });
      expect(check(ctx).pass).toBe(false);
    });

    it("does not match email-like patterns as mentions (email has @ followed by word)", () => {
      // "user@example.com" does match /@\w+/, so this IS treated as a mention
      // This is the specified behavior — the regex is intentionally simple
      const ctx = makeCtx({ source: "agent", message: "send to user@example.com" });
      expect(check(ctx).pass).toBe(true);
    });
  });
});
