import { writeLogEvent } from "./logging.js";
import type { EnforcementMode } from "./types.js";

// ---------------------------------------------------------------------------
// Config & State interfaces
// ---------------------------------------------------------------------------

export interface CircuitBreakerConfig {
  /** Consecutive failures before the breaker trips. @default 3 */
  maxConsecutiveFailures: number;
  /** Action to take when the breaker trips. @default "log" */
  degradeAction: "log" | "pause" | "alert";
  /** Minutes before the breaker auto-resets after tripping. @default 5 */
  resetAfterMinutes: number;
  /** Fall back to serial (sequential) execution when tripped. @default false */
  serialFallback: boolean;
  /** Channel identifiers where alerts should be sent. @default [] */
  notifyChannels: string[];
}

export interface CircuitBreakerState {
  failures: number;
  lastFailure?: string;
  tripped: boolean;
  trippedAt?: string;
  degradedTo?: EnforcementMode;
}

// ---------------------------------------------------------------------------
// Alert callback type
// ---------------------------------------------------------------------------

export type CircuitBreakerAlertFn = (
  channels: string[],
  state: Readonly<CircuitBreakerState>,
) => void;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxConsecutiveFailures: 3,
  degradeAction: "log",
  resetAfterMinutes: 5,
  serialFallback: false,
  notifyChannels: [],
};

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private state: CircuitBreakerState;
  private readonly onAlert?: CircuitBreakerAlertFn;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    config?: Partial<CircuitBreakerConfig>,
    onAlert?: CircuitBreakerAlertFn,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.onAlert = onAlert;
    this.state = { failures: 0, tripped: false };
  }

  // ---- public API ---------------------------------------------------------

  /** Record a failure. Trips the breaker when the threshold is reached. */
  recordFailure(): void {
    this.checkAutoReset();

    this.state.failures += 1;
    this.state.lastFailure = new Date().toISOString();

    if (!this.state.tripped && this.state.failures >= this.config.maxConsecutiveFailures) {
      this.trip();
    }
  }

  /** Record a success. Resets the consecutive failure counter (but does NOT un-trip a tripped breaker). */
  recordSuccess(): void {
    this.checkAutoReset();

    // A success resets the consecutive failure count.
    // If the breaker is already tripped we leave it tripped — only the
    // cooldown timer or an explicit reset() can un-trip it.
    this.state.failures = 0;
  }

  /** Returns `true` when the breaker is currently tripped. */
  isTripped(): boolean {
    this.checkAutoReset();
    return this.state.tripped;
  }

  /** Manually reset the breaker, clearing all failure state. */
  reset(): void {
    this.clearResetTimer();

    const wasTripped = this.state.tripped;
    this.state = { failures: 0, tripped: false };

    if (wasTripped) {
      writeLogEvent({
        level: "info",
        component: "circuit-breaker",
        action: "reset",
        message: "Circuit breaker manually reset",
      });
    }
  }

  /** Return a readonly snapshot of the current state. */
  getState(): Readonly<CircuitBreakerState> {
    this.checkAutoReset();
    return { ...this.state };
  }

  /**
   * Given a *requested* enforcement mode, return the *effective* mode.
   *
   * When the breaker is tripped, enforcement degrades to `"log"` so that the
   * system never force-retries or blocks while things are broken.  If the
   * requested mode is already `"off"` or `"log"` it is returned as-is because
   * those are equal-or-less-strict than the degraded level.
   */
  getEffectiveEnforcement(requested: EnforcementMode): EnforcementMode {
    this.checkAutoReset();

    if (!this.state.tripped) {
      return requested;
    }

    // When tripped, never return something stricter than "log".
    const strict: EnforcementMode[] = ["advise", "enforce"];
    if (strict.includes(requested)) {
      return "log";
    }

    return requested;
  }

  /** Whether serial (sequential) fallback is active. */
  get serialFallbackActive(): boolean {
    this.checkAutoReset();
    return this.state.tripped && this.config.serialFallback;
  }

  // ---- internals ----------------------------------------------------------

  private trip(): void {
    this.state.tripped = true;
    this.state.trippedAt = new Date().toISOString();
    this.state.degradedTo = "log";

    writeLogEvent({
      level: "warn",
      component: "circuit-breaker",
      action: "trip",
      message: `Circuit breaker tripped after ${this.state.failures} consecutive failures`,
      data: {
        failures: this.state.failures,
        degradeAction: this.config.degradeAction,
        serialFallback: this.config.serialFallback,
      },
    });

    // Fire optional alert callback.
    if (this.onAlert && this.config.notifyChannels.length > 0) {
      try {
        this.onAlert(this.config.notifyChannels, { ...this.state });
      } catch {
        // Alert delivery must never crash the runtime.
      }
    }

    // Schedule auto-reset.
    this.scheduleAutoReset();
  }

  private scheduleAutoReset(): void {
    this.clearResetTimer();

    const ms = this.config.resetAfterMinutes * 60_000;
    if (ms <= 0) return;

    this.resetTimer = setTimeout(() => {
      this.autoReset();
    }, ms);

    // Allow the Node process to exit even if the timer is still pending.
    if (this.resetTimer && typeof this.resetTimer === "object" && "unref" in this.resetTimer) {
      (this.resetTimer as NodeJS.Timeout).unref();
    }
  }

  private autoReset(): void {
    this.clearResetTimer();

    if (!this.state.tripped) return;

    this.state = { failures: 0, tripped: false };

    writeLogEvent({
      level: "info",
      component: "circuit-breaker",
      action: "auto-reset",
      message: `Circuit breaker auto-reset after ${this.config.resetAfterMinutes} minute cooldown`,
    });
  }

  /**
   * Check whether enough time has elapsed for an auto-reset.
   *
   * This is a fallback for environments where `setTimeout` may not fire
   * reliably (e.g. the timer was garbage-collected). It runs on every public
   * method call so state is always consistent.
   */
  private checkAutoReset(): void {
    if (!this.state.tripped || !this.state.trippedAt) return;

    const elapsed = Date.now() - new Date(this.state.trippedAt).getTime();
    const cooldownMs = this.config.resetAfterMinutes * 60_000;

    if (cooldownMs > 0 && elapsed >= cooldownMs) {
      this.autoReset();
    }
  }

  private clearResetTimer(): void {
    if (this.resetTimer !== undefined) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
  }
}
