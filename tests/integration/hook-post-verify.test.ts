import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPostVerifyHook, detectServiceOperation } from "../../packages/core/src/hooks/post-verify.js";
import type { HealthCheckResult } from "../../packages/core/src/hooks/post-verify.js";
import type { HookContext, AgentResponse, HookResult, Hook, EnforcementMode } from "../../packages/core/src/hooks/types.js";
import type { Profile } from "@axiom-labs/arc-core";

// Suppress NDJSON log writes during tests
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

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
    message: "do something",
    sessionId: "sess-1",
    profile: makeProfile("enforce"),
    adapter: "test",
    hookMetadata: {},
    ...overrides,
  };
}

function makeResponse(content: string, toolCalls?: unknown[]): AgentResponse {
  return { content, toolCalls };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("createPostVerifyHook — factory shape", () => {
  it("returns a Hook with correct name, events, and priority", () => {
    const hook = createPostVerifyHook();
    expect(hook.name).toBe("post-verify");
    expect(hook.events).toEqual(["post-message"]);
    expect(hook.priority).toBe(95);
    expect(typeof hook.check).toBe("function");
    expect(typeof hook.postProcess).toBe("function");
  });

  it("works with no options (default factory)", () => {
    const hook = createPostVerifyHook();
    expect(hook.name).toBe("post-verify");
  });

  it("accepts custom options", () => {
    const hook = createPostVerifyHook({
      healthCheckFn: async () => [],
      pollTimeoutMs: 5000,
      pollIntervalMs: 500,
    });
    expect(hook.name).toBe("post-verify");
  });
});

describe("check() — always passes", () => {
  it("returns pass=true in enforce mode", () => {
    const hook = createPostVerifyHook();
    const ctx = makeCtx({ profile: makeProfile("enforce") });
    const result = hook.check(ctx) as HookResult;
    expect(result).toEqual({ pass: true });
  });

  it("returns pass=true in log mode", () => {
    const hook = createPostVerifyHook();
    const ctx = makeCtx({ profile: makeProfile("log") });
    const result = hook.check(ctx) as HookResult;
    expect(result).toEqual({ pass: true });
  });

  it("returns pass=true in advise mode", () => {
    const hook = createPostVerifyHook();
    const ctx = makeCtx({ profile: makeProfile("advise") });
    const result = hook.check(ctx) as HookResult;
    expect(result).toEqual({ pass: true });
  });

  it("never sets block=true", () => {
    const hook = createPostVerifyHook();
    const ctx = makeCtx();
    const result = hook.check(ctx) as HookResult;
    expect(result.block).toBeUndefined();
  });
});

describe("detectServiceOperation", () => {
  it("detects 'restarted the service'", () => {
    expect(detectServiceOperation("I restarted the service")).toBe(true);
  });

  it("detects 'deployed the app'", () => {
    expect(detectServiceOperation("Successfully deployed the app")).toBe(true);
  });

  it("detects 'config change'", () => {
    expect(detectServiceOperation("Applied a config change to production")).toBe(true);
  });

  it("detects 'service reload'", () => {
    expect(detectServiceOperation("Performed a service reload")).toBe(true);
  });

  it("detects 'deployment' (word-boundary match)", () => {
    expect(detectServiceOperation("Explain deployment strategies")).toBe(true);
  });

  it("does NOT trigger on 'read the config'", () => {
    expect(detectServiceOperation("I read the config file")).toBe(false);
  });

  it("does NOT trigger on unrelated text", () => {
    expect(detectServiceOperation("The weather is nice today")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(detectServiceOperation("")).toBe(false);
  });

  it("returns false for undefined-ish input", () => {
    expect(detectServiceOperation(undefined as unknown as string)).toBe(false);
  });
});

describe("postProcess() — no service operation", () => {
  it("does not call healthCheckFn when no service-op detected", async () => {
    const healthCheckFn = vi.fn().mockResolvedValue([]);
    const hook = createPostVerifyHook({ healthCheckFn });
    const ctx = makeCtx();
    const response = makeResponse("Just a normal response with no ops");

    await hook.postProcess!(ctx, response);

    expect(healthCheckFn).not.toHaveBeenCalled();
    // Metadata should not have post_verify keys
    expect(ctx.hookMetadata).toEqual({});
  });
});

describe("postProcess() — default healthCheckFn (pass-through)", () => {
  it("detects service op but default fn returns empty array → healthy metadata", async () => {
    const hook = createPostVerifyHook(); // default healthCheckFn
    const ctx = makeCtx();
    const response = makeResponse("I restarted the gateway service");

    await hook.postProcess!(ctx, response);

    expect(ctx.hookMetadata).toMatchObject({
      post_verify_healthy: true,
    });
    expect(ctx.hookMetadata!.verified_at).toBeDefined();
  });
});

describe("postProcess() — custom healthCheckFn", () => {
  it("invoked when service operation detected", async () => {
    const healthCheckFn = vi.fn().mockResolvedValue([
      { name: "gateway", healthy: true },
    ]);
    const hook = createPostVerifyHook({ healthCheckFn });
    const ctx = makeCtx();
    const response = makeResponse("deployed new version");

    await hook.postProcess!(ctx, response);

    expect(healthCheckFn).toHaveBeenCalled();
  });

  it("all healthy → metadata injected with per-service status and verified_at", async () => {
    const healthCheckFn = vi.fn().mockResolvedValue([
      { name: "gateway", healthy: true },
      { name: "watchdog", healthy: true },
    ]);
    const hook = createPostVerifyHook({ healthCheckFn });
    const ctx = makeCtx();
    const response = makeResponse("restarted the services");

    await hook.postProcess!(ctx, response);

    expect(ctx.hookMetadata).toMatchObject({
      gateway_healthy: true,
      watchdog_healthy: true,
      post_verify_healthy: true,
    });
    expect(ctx.hookMetadata!.verified_at).toBeDefined();
    expect(ctx.hookMetadata!.post_verify_alert).toBeUndefined();
  });

  it("unhealthy service → alert metadata injected, still no block", async () => {
    const healthCheckFn = vi.fn().mockResolvedValue([
      { name: "gateway", healthy: false, detail: "connection refused" },
      { name: "watchdog", healthy: true },
    ]);
    const hook = createPostVerifyHook({
      healthCheckFn,
      pollTimeoutMs: 50, // short timeout for test speed
      pollIntervalMs: 10,
    });
    const ctx = makeCtx();
    const response = makeResponse("deployed the app");

    await hook.postProcess!(ctx, response);

    expect(ctx.hookMetadata).toMatchObject({
      gateway_healthy: false,
      watchdog_healthy: true,
      post_verify_healthy: false,
      post_verify_timed_out: true,
    });
    expect(ctx.hookMetadata!.post_verify_alert).toMatch(/gateway/);
    expect(ctx.hookMetadata!.gateway_detail).toBe("connection refused");
    // Critically — check() still passes
    const checkResult = hook.check(ctx) as HookResult;
    expect(checkResult.pass).toBe(true);
    expect(checkResult.block).toBeUndefined();
  });

  it("healthCheckFn that eventually becomes healthy stops polling", async () => {
    let callCount = 0;
    const healthCheckFn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        return [{ name: "gateway", healthy: false }];
      }
      return [{ name: "gateway", healthy: true }];
    });
    const hook = createPostVerifyHook({
      healthCheckFn,
      pollTimeoutMs: 5000,
      pollIntervalMs: 10,
    });
    const ctx = makeCtx();
    const response = makeResponse("restarted services");

    await hook.postProcess!(ctx, response);

    expect(callCount).toBeGreaterThanOrEqual(3);
    expect(ctx.hookMetadata).toMatchObject({
      gateway_healthy: true,
      post_verify_healthy: true,
    });
    expect(ctx.hookMetadata!.post_verify_timed_out).toBeUndefined();
  });
});

describe("postProcess() — error handling", () => {
  it("healthCheckFn throws → caught, logged, alert metadata injected, no block", async () => {
    const healthCheckFn = vi.fn().mockRejectedValue(new Error("network failure"));
    const hook = createPostVerifyHook({ healthCheckFn });
    const ctx = makeCtx();
    const response = makeResponse("deployed the new config");

    await hook.postProcess!(ctx, response);

    expect(ctx.hookMetadata).toMatchObject({
      post_verify_error: "network failure",
      post_verify_healthy: false,
    });
    expect(ctx.hookMetadata!.verified_at).toBeDefined();
    // check() must still pass
    const checkResult = hook.check(ctx) as HookResult;
    expect(checkResult.pass).toBe(true);
  });

  it("healthCheckFn times out → timed_out flag in metadata, no block", async () => {
    const healthCheckFn = vi.fn().mockResolvedValue([
      { name: "slow-svc", healthy: false },
    ]);
    const hook = createPostVerifyHook({
      healthCheckFn,
      pollTimeoutMs: 50,
      pollIntervalMs: 10,
    });
    const ctx = makeCtx();
    const response = makeResponse("restarted slow-svc");

    await hook.postProcess!(ctx, response);

    expect(ctx.hookMetadata!.post_verify_timed_out).toBe(true);
    expect(ctx.hookMetadata!.post_verify_healthy).toBe(false);
    const checkResult = hook.check(ctx) as HookResult;
    expect(checkResult.pass).toBe(true);
  });
});

describe("postProcess() — malformed/edge inputs", () => {
  it("empty response content → no service op, healthCheckFn not called", async () => {
    const healthCheckFn = vi.fn().mockResolvedValue([]);
    const hook = createPostVerifyHook({ healthCheckFn });
    const ctx = makeCtx();
    const response = makeResponse("");

    await hook.postProcess!(ctx, response);

    expect(healthCheckFn).not.toHaveBeenCalled();
  });

  it("response with undefined content → no crash, no call", async () => {
    const healthCheckFn = vi.fn().mockResolvedValue([]);
    const hook = createPostVerifyHook({ healthCheckFn });
    const ctx = makeCtx();
    const response = { content: undefined as unknown as string };

    await hook.postProcess!(ctx, response);

    expect(healthCheckFn).not.toHaveBeenCalled();
  });
});
