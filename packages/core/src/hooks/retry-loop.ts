import { writeLogEvent } from "../logging.js";
import type { HookBus } from "./hook-bus.js";
import type { HookStateStore } from "./hook-state.js";
import type {
  HookContext,
  AgentResponse,
  EnforcementMode,
  CompletionAudit,
} from "./types.js";

/** Default confidence threshold below which enforce-mode retries. */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.4;

/** Default maximum number of attempts before giving up. */
const DEFAULT_MAX_ATTEMPTS = 3;

export interface RunWithRetryOptions {
  /** The hook bus to run post-hooks through. */
  bus: HookBus;
  /** State store shared across hooks (holds audit results, attempt counts). */
  stateStore: HookStateStore;
  /** Hook context for this turn. */
  ctx: HookContext;
  /** Current enforcement mode. */
  enforcement: EnforcementMode;
  /** Callback that executes the agent and returns a response. */
  executeAgent: () => Promise<AgentResponse>;
  /** Maximum attempts before stopping. Defaults to 3. */
  maxAttempts?: number;
  /** Confidence below this triggers retry in enforce mode. Defaults to 0.4. */
  confidenceThreshold?: number;
}

export interface RunWithRetryResult {
  /** The final agent response (from the last attempt). */
  response: AgentResponse;
  /** Total number of attempts made. */
  attempts: number;
  /** The audit result from the last attempt, if available. */
  auditResult?: CompletionAudit;
}

/**
 * Coordinator that runs the agent and post-hooks in a loop,
 * retrying in enforce mode when audit confidence is below threshold.
 *
 * In non-enforce modes (log, advise, off) the agent runs exactly once.
 * Thrown errors from executeAgent propagate immediately — only low
 * confidence triggers retries.
 */
export async function runWithRetry(
  opts: RunWithRetryOptions,
): Promise<RunWithRetryResult> {
  const {
    bus,
    stateStore,
    ctx,
    enforcement,
    executeAgent,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
  } = opts;

  let lastResponse: AgentResponse | undefined;
  let lastAudit: CompletionAudit | undefined;
  let attempts = 0;

  const shouldRetry = enforcement === "enforce";

  for (let i = 0; i < maxAttempts; i++) {
    attempts++;

    writeLogEvent({
      level: "info",
      component: "retry-loop",
      action: "attempt-start",
      message: `Starting attempt ${attempts}/${maxAttempts}`,
      data: {
        attempt: attempts,
        maxAttempts,
        enforcement,
        confidenceThreshold,
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
      },
    });

    // Execute the agent — errors propagate, not retried
    lastResponse = await executeAgent();

    // Run post-hooks (audit-score writes to stateStore, attempt-tracker increments)
    await bus.runPost(ctx, lastResponse, enforcement, "post-message");

    // Read the audit result deposited by audit-score hook
    lastAudit = stateStore.get<CompletionAudit>(
      ctx.sessionId,
      "audit-score",
      "auditResult",
    );

    const confidence = lastAudit?.confidence ?? 0;
    const belowThreshold = confidence < confidenceThreshold;

    writeLogEvent({
      level: belowThreshold && shouldRetry ? "warn" : "info",
      component: "retry-loop",
      action: "attempt-end",
      message: `Attempt ${attempts} complete: confidence=${confidence}, threshold=${confidenceThreshold}, retry=${shouldRetry && belowThreshold && attempts < maxAttempts}`,
      data: {
        attempt: attempts,
        maxAttempts,
        confidence,
        confidenceThreshold,
        belowThreshold,
        enforcement,
        auditStatus: lastAudit?.status,
        auditRecommendation: lastAudit?.recommendation,
        willRetry: shouldRetry && belowThreshold && attempts < maxAttempts,
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
      },
    });

    // In non-enforce modes, always break after first attempt
    if (!shouldRetry) {
      break;
    }

    // In enforce mode, break if confidence is acceptable
    if (!belowThreshold) {
      break;
    }

    // If we've hit max attempts, stop (loop condition will also catch this)
    if (attempts >= maxAttempts) {
      writeLogEvent({
        level: "warn",
        component: "retry-loop",
        action: "max-attempts",
        message: `Max attempts (${maxAttempts}) reached with confidence ${confidence} still below threshold ${confidenceThreshold}`,
        data: {
          attempts,
          maxAttempts,
          confidence,
          confidenceThreshold,
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
        },
      });
      break;
    }

    // Otherwise, loop for another attempt
  }

  return {
    response: lastResponse!,
    attempts,
    auditResult: lastAudit,
  };
}
