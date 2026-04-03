import { writeLogEvent } from "../logging.js";
import { auditCompletion } from "./completion-auditor.js";
import type { Hook, HookContext, HookResult, AgentResponse, EnforcementMode, CompletionAudit } from "./types.js";
import type { HookStateStore } from "./hook-state.js";

/** State key used inside HookStateStore for the last audit result. */
const AUDIT_KEY = "auditResult";

/** Confidence threshold below which enforce mode blocks. */
const CONFIDENCE_THRESHOLD = 0.4;

/**
 * Factory — creates an audit-score hook bound to a HookStateStore.
 *
 * Priority 90, post-message: runs auditCompletion() on every agent response
 * and writes the CompletionAudit to the state store. check() reads the last
 * audit and decides whether to block (enforce mode, confidence < threshold)
 * or flag (log/advise mode).
 */
export function createAuditScoreHook(stateStore: HookStateStore): Hook {
  return {
    name: "audit-score",
    events: ["post-message"],
    priority: 90,

    check(ctx: HookContext): HookResult {
      const enforcement: EnforcementMode = ctx.profile.enforcement ?? "log";
      const audit = stateStore.get<CompletionAudit>(
        ctx.sessionId,
        "audit-score",
        AUDIT_KEY,
      );

      // No prior audit — nothing to judge
      if (!audit) {
        return { pass: true };
      }

      const belowThreshold = audit.confidence < CONFIDENCE_THRESHOLD;
      const shouldBlock = enforcement === "enforce" && belowThreshold;
      const shouldFlag = belowThreshold && !shouldBlock;

      writeLogEvent({
        level: shouldBlock ? "warn" : "info",
        component: "hook:audit-score",
        action: "check",
        message: `Audit check: status=${audit.status} confidence=${audit.confidence} recommendation=${audit.recommendation}`,
        data: {
          status: audit.status,
          confidence: audit.confidence,
          recommendation: audit.recommendation,
          belowThreshold,
          shouldBlock,
          enforcement,
          sessionId: ctx.sessionId,
        },
      });

      return {
        pass: !shouldBlock,
        block: shouldBlock,
        flag: shouldFlag
          ? `Low confidence (${audit.confidence}) — recommendation: ${audit.recommendation}`
          : undefined,
        reason: shouldBlock
          ? `Blocked: audit confidence (${audit.confidence}) below threshold (${CONFIDENCE_THRESHOLD})`
          : undefined,
        metadata: {
          auditStatus: audit.status,
          auditConfidence: audit.confidence,
          auditRecommendation: audit.recommendation,
        },
      };
    },

    async postProcess(ctx: HookContext, response: AgentResponse): Promise<void> {
      const audit = auditCompletion(response);

      stateStore.set(ctx.sessionId, "audit-score", AUDIT_KEY, audit);

      writeLogEvent({
        level: audit.confidence < CONFIDENCE_THRESHOLD ? "warn" : "info",
        component: "hook:audit-score",
        action: "postProcess",
        message: `Audit complete: status=${audit.status} confidence=${audit.confidence} recommendation=${audit.recommendation}`,
        data: {
          status: audit.status,
          confidence: audit.confidence,
          recommendation: audit.recommendation,
          checksPassed: audit.checksPassed,
          checksFailed: audit.checksFailed,
          overreachDetected: audit.overreachDetected,
          sessionId: ctx.sessionId,
        },
      });
    },
  };
}
