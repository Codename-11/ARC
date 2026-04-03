import { writeLogEvent } from "../logging.js";
import type { Hook, HookContext, HookResult, HookMetadata, EnforcementMode } from "./types.js";
import { classifyRisk } from "./risk-classifier.js";

/**
 * Risk-detection hook — classifies message risk using word-boundary keyword matching.
 * Priority 10 — runs after source-classify (priority 1) so source context is available.
 *
 * In enforce mode, blocks destructive and deploy-affecting messages.
 * In other modes, flags them without blocking.
 *
 * The enforcement mode is read from ctx.profile.enforcement, defaulting to "log".
 */
export const riskDetectionHook: Hook = {
  name: "risk-detection",
  events: ["pre-message"],
  priority: 10,

  check(ctx: HookContext): HookResult {
    const classification = classifyRisk(ctx.message);
    const enforcement: EnforcementMode = ctx.profile.enforcement ?? "log";

    const shouldBlock =
      classification.requiresConfirmation && enforcement === "enforce";

    writeLogEvent({
      level: shouldBlock ? "warn" : "info",
      component: "hook:risk-detection",
      action: "classify",
      message: `Risk tier '${classification.tier}' for message (${classification.reasons.length} reason(s))`,
      data: {
        tier: classification.tier,
        reasons: classification.reasons,
        requiresConfirmation: classification.requiresConfirmation,
        checklistIntensity: classification.checklistIntensity,
        enforcement,
        blocked: shouldBlock,
        source: ctx.source ?? "unknown",
      },
    });

    return {
      pass: !shouldBlock,
      block: shouldBlock,
      tier: classification.tier,
      reason: shouldBlock
        ? `Blocked: ${classification.tier} operation requires confirmation (enforcement=enforce)`
        : undefined,
      flag: classification.requiresConfirmation && !shouldBlock
        ? `${classification.tier} operation would require confirmation`
        : undefined,
      metadata: {
        riskTier: classification.tier,
        riskReasons: classification.reasons,
        requiresConfirmation: classification.requiresConfirmation,
        checklistIntensity: classification.checklistIntensity,
      },
    };
  },

  inject(ctx: HookContext): HookMetadata | undefined {
    const classification = classifyRisk(ctx.message);
    // Enrich context for downstream hooks
    ctx.riskTier = classification.tier;
    return {
      riskTier: classification.tier,
      riskReasons: classification.reasons,
      requiresConfirmation: classification.requiresConfirmation,
    };
  },
};
