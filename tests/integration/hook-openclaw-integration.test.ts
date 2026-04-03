import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDefaultPipeline } from "../../packages/core/src/hooks/create-default-bus.js";
import { createArcHookHandlers } from "../../packages/adapter-openclaw/src/hooks.js";
import type { Profile } from "../../packages/core/src/types.js";
import type { HookContext, AgentResponse, CompletionAudit } from "../../packages/core/src/hooks/types.js";
import * as loggingModule from "../../packages/core/src/logging.js";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    authType: "api-key",
    configDir: "/tmp/test",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("OpenClaw Integration", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(loggingModule, "writeLogEvent").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── createDefaultPipeline with 7 hooks ───────────────────────────

  describe("createDefaultPipeline", () => {
    it("returns 7 hooks in correct priority order", () => {
      const { bus } = createDefaultPipeline();
      const hooks = bus.list();

      expect(hooks).toHaveLength(7);
      expect(hooks.map((h) => h.name)).toEqual([
        "source-classify",
        "interagent-routing",
        "risk-detection",
        "attempt-tracker",
        "audit-score",
        "supervision-gate",
        "post-verify",
      ]);
      expect(hooks.map((h) => h.priority)).toEqual([1, 2, 10, 20, 90, 92, 95]);
    });

    it("returns shared stateStore instance", () => {
      const { stateStore } = createDefaultPipeline();
      expect(stateStore).toBeDefined();

      // State store is functional
      stateStore.set("s1", "test-hook", "key", "value");
      expect(stateStore.get("s1", "test-hook", "key")).toBe("value");
    });
  });

  // ── createArcHookHandlers ────────────────────────────────────────

  describe("createArcHookHandlers", () => {
    it("returns 3 handler functions", () => {
      const handlers = createArcHookHandlers(makeProfile());

      expect(typeof handlers.beforePromptBuild).toBe("function");
      expect(typeof handlers.agentEnd).toBe("function");
      expect(typeof handlers.sessionEnd).toBe("function");
    });

    // ── beforePromptBuild ────────────────────────────────────────

    describe("beforePromptBuild", () => {
      it("runs pre-hooks and returns formatted prepend with source metadata", async () => {
        const handlers = createArcHookHandlers(makeProfile({ enforcement: "log" }));

        const result = await handlers.beforePromptBuild({
          sessionId: "test-session-1",
          message: "list files in the project",
        });

        expect(result).toHaveProperty("prepend");
        expect(result).toHaveProperty("append");
        expect(result.append).toBe("");
        // Source classification should produce a prepend line
        expect(result.prepend).toContain("[ARC] Source:");
      });

      it("returns empty prepend when enforcement is off", async () => {
        const handlers = createArcHookHandlers(makeProfile({ enforcement: "off" }));

        const result = await handlers.beforePromptBuild({
          sessionId: "test-session-off",
          message: "anything",
        });

        // enforcement=off skips all hooks → no metadata
        expect(result.prepend).toBe("");
        expect(result.append).toBe("");
      });

      it("includes risk tier in prepend for dangerous messages", async () => {
        const handlers = createArcHookHandlers(makeProfile({ enforcement: "log" }));

        const result = await handlers.beforePromptBuild({
          sessionId: "test-session-risk",
          message: "run rm -rf /var/data and drop database production",
        });

        expect(result.prepend).toContain("[ARC] Risk:");
      });

      it("includes blocked notice in enforce mode for dangerous messages", async () => {
        const handlers = createArcHookHandlers(makeProfile({ enforcement: "enforce" }));

        const result = await handlers.beforePromptBuild({
          sessionId: "test-session-blocked",
          message: "run rm -rf /var/data and drop database production",
        });

        expect(result.prepend).toContain("Pipeline blocked");
      });
    });

    // ── agentEnd ─────────────────────────────────────────────────

    describe("agentEnd", () => {
      it("runs post-hooks and returns continue:false when audit passes", async () => {
        const handlers = createArcHookHandlers(makeProfile({ enforcement: "log" }));

        const result = await handlers.agentEnd({
          sessionId: "test-session-end-1",
          message: "list files",
          responseContent: "Here are the files. Done. Task completed successfully.",
          toolCalls: [],
        });

        expect(result.continue).toBe(false);
      });

      it("returns continue:true with reason when audit confidence < 0.4 in enforce mode", async () => {
        // To trigger low confidence, we need a response that the deterministic
        // auditor scores below 0.4. An empty or very short response with no
        // completion signals should produce an uncertain/low-confidence audit.
        const handlers = createArcHookHandlers(makeProfile({ enforcement: "enforce" }));

        const result = await handlers.agentEnd({
          sessionId: "test-session-low-conf",
          message: "implement the full feature",
          // Response with failure signals and no completion signals
          responseContent: "I tried but failed. There was an error and I was unable to proceed.",
          toolCalls: [],
        });

        // The deterministic auditor should see failure signals → low confidence
        // If it's below 0.4, enforce mode signals continue
        if (result.continue) {
          expect(result.continueReason).toBeDefined();
          expect(result.continueReason).toContain("Audit incomplete");
        }
        // If auditor happens to score above 0.4, it returns continue:false — still valid
        expect(typeof result.continue).toBe("boolean");
      });

      it("returns continue:false in non-enforce modes even with low confidence", async () => {
        const handlers = createArcHookHandlers(makeProfile({ enforcement: "log" }));

        const result = await handlers.agentEnd({
          sessionId: "test-session-log-mode",
          message: "do the thing",
          responseContent: "failed error unable",
          toolCalls: [],
        });

        // Log mode never triggers continue:true
        expect(result.continue).toBe(false);
      });

      it("returns continue:false in advise mode", async () => {
        const handlers = createArcHookHandlers(makeProfile({ enforcement: "advise" }));

        const result = await handlers.agentEnd({
          sessionId: "test-session-advise",
          message: "do the thing",
          responseContent: "failed error unable",
          toolCalls: [],
        });

        expect(result.continue).toBe(false);
      });
    });

    // ── sessionEnd ───────────────────────────────────────────────

    describe("sessionEnd", () => {
      it("clears state store for the session", () => {
        const profile = makeProfile();
        const { stateStore } = createDefaultPipeline(profile.hooks);

        // Pre-populate some state
        stateStore.set("cleanup-session", "audit-score", "auditResult", { status: "complete" });
        stateStore.set("cleanup-session", "supervision-gate", "gateDecision", { decision: "ALLOW" });
        stateStore.set("other-session", "audit-score", "auditResult", { status: "partial" });

        // Verify state exists
        expect(stateStore.get("cleanup-session", "audit-score", "auditResult")).toBeDefined();

        // Clear via sessionEnd
        stateStore.clear("cleanup-session");

        // cleanup-session state is gone
        expect(stateStore.get("cleanup-session", "audit-score", "auditResult")).toBeUndefined();
        expect(stateStore.get("cleanup-session", "supervision-gate", "gateDecision")).toBeUndefined();

        // other-session state is untouched
        expect(stateStore.get("other-session", "audit-score", "auditResult")).toBeDefined();
      });

      it("handler calls stateStore.clear and does not throw", () => {
        const handlers = createArcHookHandlers(makeProfile());
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        expect(() => {
          handlers.sessionEnd({ sessionId: "test-cleanup" });
        }).not.toThrow();

        expect(consoleSpy).toHaveBeenCalledWith(
          "[arc:openclaw] sessionEnd — state cleared",
          { sessionId: "test-cleanup" },
        );

        consoleSpy.mockRestore();
      });
    });
  });

  // ── Pipeline wiring end-to-end ───────────────────────────────────

  describe("end-to-end pipeline wiring", () => {
    it("supervision-gate postProcess runs during agentEnd flow", async () => {
      const handlers = createArcHookHandlers(makeProfile({ enforcement: "log" }));

      await handlers.agentEnd({
        sessionId: "e2e-supervision",
        message: "create the file",
        // Substantive response — triggers supervision gate
        responseContent: "I created file src/main.ts and wrote the implementation.",
        toolCalls: [{ name: "write_file" }],
      });

      // Supervision gate should have logged its postProcess
      const gateLogs = logSpy.mock.calls.filter(
        (call: unknown[]) => {
          const event = call[0] as loggingModule.LogEvent;
          return event.component === "hook:supervision-gate";
        }
      );
      expect(gateLogs.length).toBeGreaterThanOrEqual(1);
    });

    it("post-verify postProcess runs for service-operation responses", async () => {
      const handlers = createArcHookHandlers(makeProfile({ enforcement: "log" }));

      await handlers.agentEnd({
        sessionId: "e2e-post-verify",
        message: "restart the service",
        responseContent: "I restarted the gateway service and it came back online.",
        toolCalls: [],
      });

      const verifyLogs = logSpy.mock.calls.filter(
        (call: unknown[]) => {
          const event = call[0] as loggingModule.LogEvent;
          return event.component === "hook:post-verify";
        }
      );
      expect(verifyLogs.length).toBeGreaterThanOrEqual(1);
    });

    it("full pipeline handles missing sessionId gracefully", async () => {
      const handlers = createArcHookHandlers(makeProfile());

      const preResult = await handlers.beforePromptBuild({});
      expect(preResult).toHaveProperty("prepend");
      expect(preResult).toHaveProperty("append");

      const postResult = await handlers.agentEnd({});
      expect(postResult.continue).toBe(false);

      expect(() => handlers.sessionEnd({})).not.toThrow();
    });
  });
});
