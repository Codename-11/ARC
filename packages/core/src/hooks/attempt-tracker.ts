import { writeLogEvent } from "../logging.js";
import type { Hook, HookContext, HookResult, AgentResponse, EnforcementMode } from "./types.js";
import type { HookStateStore } from "./hook-state.js";

/** State key used inside HookStateStore for the attempt count. */
const ATTEMPT_KEY = "attemptCount";

/** Default maximum retry attempts before blocking in enforce mode. */
const DEFAULT_MAX_ATTEMPTS = 3;

export interface AttemptTrackerOptions {
  /** Maximum retries before blocking. Defaults to 3. */
  maxAttempts?: number;
}

/**
 * Factory — creates an attempt-tracker hook bound to a HookStateStore.
 *
 * Priority 20, post-message: increments attempt count per session+turn after each
 * agent response. check() reads the current count and signals whether a retry
 * is appropriate (enforce mode) or simply reports the count (log/advise).
 */
export function createAttemptTracker(
  stateStore: HookStateStore,
  opts?: AttemptTrackerOptions,
): Hook {
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  /** Derive the state-store key that isolates counts per turn within a session. */
  function turnKey(ctx: HookContext): string {
    return ctx.turnId ?? ctx.sessionId;
  }

  function getCount(ctx: HookContext): number {
    return stateStore.get<number>(ctx.sessionId, "attempt-tracker", `${ATTEMPT_KEY}:${turnKey(ctx)}`) ?? 0;
  }

  function setCount(ctx: HookContext, count: number): void {
    stateStore.set(ctx.sessionId, "attempt-tracker", `${ATTEMPT_KEY}:${turnKey(ctx)}`, count);
  }

  return {
    name: "attempt-tracker",
    events: ["post-message"],
    priority: 20,

    check(ctx: HookContext): HookResult {
      const attemptCount = getCount(ctx);
      const enforcement: EnforcementMode = ctx.profile.enforcement ?? "log";
      const atOrOverMax = attemptCount >= maxAttempts;
      const shouldRetry = enforcement === "enforce" ? !atOrOverMax : false;
      const shouldBlock = enforcement === "enforce" && atOrOverMax;

      writeLogEvent({
        level: shouldBlock ? "warn" : "info",
        component: "hook:attempt-tracker",
        action: "check",
        message: `Attempt ${attemptCount}/${maxAttempts} for turn '${turnKey(ctx)}'`,
        data: {
          attemptCount,
          maxAttempts,
          shouldRetry,
          shouldBlock,
          enforcement,
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
        },
      });

      return {
        pass: !shouldBlock,
        block: shouldBlock,
        reason: shouldBlock
          ? `Blocked: max attempts (${maxAttempts}) reached for turn '${turnKey(ctx)}'`
          : undefined,
        metadata: {
          attemptCount,
          maxAttempts,
          shouldRetry,
        },
      };
    },

    async postProcess(ctx: HookContext, _response: AgentResponse): Promise<void> {
      const prev = getCount(ctx);
      const next = prev + 1;
      setCount(ctx, next);

      writeLogEvent({
        level: "info",
        component: "hook:attempt-tracker",
        action: "increment",
        message: `Incremented attempt count ${prev} → ${next} for turn '${turnKey(ctx)}'`,
        data: {
          previousCount: prev,
          newCount: next,
          maxAttempts,
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
        },
      });
    },
  };
}
