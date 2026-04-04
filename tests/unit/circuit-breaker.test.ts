import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CircuitBreaker } from "../../packages/core/src/circuit-breaker.js";
import type { EnforcementMode } from "../../packages/core/src/types.js";

// Suppress log I/O during tests
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

// ─── Tests ──────────────────────────────────────────────────────────

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker();
  });

  afterEach(() => {
    cb.reset();
  });

  // ── Default config ──────────────────────────────────────────────

  describe("default config", () => {
    it("starts with 0 failures and not tripped", () => {
      const state = cb.getState();
      expect(state.failures).toBe(0);
      expect(state.tripped).toBe(false);
    });

    it("trips after 3 consecutive failures (default threshold)", () => {
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.isTripped()).toBe(false);

      cb.recordFailure();
      expect(cb.isTripped()).toBe(true);
    });
  });

  // ── recordFailure ─────────────────────────────────────────────

  describe("recordFailure()", () => {
    it("increments failure count", () => {
      cb.recordFailure();
      expect(cb.getState().failures).toBe(1);

      cb.recordFailure();
      expect(cb.getState().failures).toBe(2);
    });

    it("sets lastFailure timestamp", () => {
      cb.recordFailure();
      expect(cb.getState().lastFailure).toBeDefined();
    });

    it("trips the breaker at the configured threshold", () => {
      const custom = new CircuitBreaker({ maxConsecutiveFailures: 2 });
      custom.recordFailure();
      expect(custom.isTripped()).toBe(false);

      custom.recordFailure();
      expect(custom.isTripped()).toBe(true);
      custom.reset();
    });

    it("does not re-trip an already tripped breaker", () => {
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.isTripped()).toBe(true);

      const trippedAt = cb.getState().trippedAt;
      cb.recordFailure();
      expect(cb.getState().trippedAt).toBe(trippedAt);
    });
  });

  // ── recordSuccess ─────────────────────────────────────────────

  describe("recordSuccess()", () => {
    it("resets the failure count to 0", () => {
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState().failures).toBe(2);

      cb.recordSuccess();
      expect(cb.getState().failures).toBe(0);
    });

    it("does NOT un-trip a tripped breaker", () => {
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.isTripped()).toBe(true);

      cb.recordSuccess();
      expect(cb.isTripped()).toBe(true);
      expect(cb.getState().failures).toBe(0);
    });
  });

  // ── isTripped ─────────────────────────────────────────────────

  describe("isTripped()", () => {
    it("returns false when no failures recorded", () => {
      expect(cb.isTripped()).toBe(false);
    });

    it("returns false when failures are below threshold", () => {
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.isTripped()).toBe(false);
    });

    it("returns true once threshold is reached", () => {
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.isTripped()).toBe(true);
    });
  });

  // ── getEffectiveEnforcement ───────────────────────────────────

  describe("getEffectiveEnforcement()", () => {
    it("returns the requested mode when not tripped", () => {
      const modes: EnforcementMode[] = ["off", "log", "advise", "enforce"];
      for (const mode of modes) {
        expect(cb.getEffectiveEnforcement(mode)).toBe(mode);
      }
    });

    it("degrades 'advise' to 'log' when tripped", () => {
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getEffectiveEnforcement("advise")).toBe("log");
    });

    it("degrades 'enforce' to 'log' when tripped", () => {
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getEffectiveEnforcement("enforce")).toBe("log");
    });

    it("passes 'off' through when tripped", () => {
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getEffectiveEnforcement("off")).toBe("off");
    });

    it("passes 'log' through when tripped", () => {
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getEffectiveEnforcement("log")).toBe("log");
    });
  });

  // ── reset ─────────────────────────────────────────────────────

  describe("reset()", () => {
    it("clears failure count and tripped state", () => {
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.isTripped()).toBe(true);

      cb.reset();

      const state = cb.getState();
      expect(state.failures).toBe(0);
      expect(state.tripped).toBe(false);
      expect(state.trippedAt).toBeUndefined();
      expect(state.degradedTo).toBeUndefined();
    });

    it("is idempotent on an already-clear breaker", () => {
      cb.reset();
      const state = cb.getState();
      expect(state.failures).toBe(0);
      expect(state.tripped).toBe(false);
    });
  });

  // ── serialFallbackActive ──────────────────────────────────────

  describe("serialFallbackActive", () => {
    it("returns false when not tripped, even if serialFallback is enabled", () => {
      const cbFallback = new CircuitBreaker({ serialFallback: true });
      expect(cbFallback.serialFallbackActive).toBe(false);
      cbFallback.reset();
    });

    it("returns false when tripped but serialFallback is disabled", () => {
      const cbNoFallback = new CircuitBreaker({ serialFallback: false });
      cbNoFallback.recordFailure();
      cbNoFallback.recordFailure();
      cbNoFallback.recordFailure();
      expect(cbNoFallback.serialFallbackActive).toBe(false);
      cbNoFallback.reset();
    });

    it("returns true when tripped and serialFallback is enabled", () => {
      const cbFallback = new CircuitBreaker({ serialFallback: true });
      cbFallback.recordFailure();
      cbFallback.recordFailure();
      cbFallback.recordFailure();
      expect(cbFallback.serialFallbackActive).toBe(true);
      cbFallback.reset();
    });
  });

  // ── Alert callback ────────────────────────────────────────────

  describe("onAlert callback", () => {
    it("fires when breaker trips and notifyChannels is non-empty", () => {
      const alertFn = vi.fn();
      const cbAlert = new CircuitBreaker(
        { notifyChannels: ["slack", "email"] },
        alertFn,
      );

      cbAlert.recordFailure();
      cbAlert.recordFailure();
      cbAlert.recordFailure();

      expect(alertFn).toHaveBeenCalledOnce();
      expect(alertFn).toHaveBeenCalledWith(
        ["slack", "email"],
        expect.objectContaining({ tripped: true, failures: 3 }),
      );
      cbAlert.reset();
    });

    it("does not fire when notifyChannels is empty", () => {
      const alertFn = vi.fn();
      const cbAlert = new CircuitBreaker(
        { notifyChannels: [] },
        alertFn,
      );

      cbAlert.recordFailure();
      cbAlert.recordFailure();
      cbAlert.recordFailure();

      expect(alertFn).not.toHaveBeenCalled();
      cbAlert.reset();
    });
  });
});
