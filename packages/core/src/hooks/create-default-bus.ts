import type { HookConfig } from "./types.js";
import { HookBus } from "./hook-bus.js";
import { HookStateStore } from "./hook-state.js";
import { sourceClassifyHook } from "./source-classify.js";
import { riskDetectionHook } from "./risk-detection.js";
import { createInteragentRoutingHook } from "./interagent-routing.js";
import { createAttemptTracker } from "./attempt-tracker.js";
import { createRoundtableHook } from "./roundtable.js";
import { createAuditScoreHook } from "./audit-score.js";
import { createSupervisionGateHook } from "./supervision-gate.js";
import { createPostVerifyHook } from "./post-verify.js";

export interface DefaultPipeline {
  bus: HookBus;
  stateStore: HookStateStore;
}

/**
 * Create a HookBus with all default hooks and a shared HookStateStore.
 *
 * Returns both the bus and the stateStore so callers (e.g. runWithRetry)
 * can read hook-deposited state like audit results and attempt counts.
 *
 * Default hooks (in priority order):
 *   1. source-classify      (priority 1)   — assigns MessageSource
 *   2. interagent-routing   (priority 2)   — suppresses bot→bot loops (roundtable-aware)
 *  10. risk-detection       (priority 10)  — classifies 5-tier risk
 *  20. attempt-tracker      (priority 20)  — counts retries per session+turn
 *  50. roundtable           (priority 50)  — multi-agent discussion orchestration
 *  90. audit-score          (priority 90)  — deterministic completion audit
 *  92. supervision-gate     (priority 92)  — ALLOW/BLOCK review of substantive output
 *  95. post-verify          (priority 95)  — health polling after service operations
 */
export function createDefaultPipeline(
  hookConfigs?: Record<string, HookConfig>,
): DefaultPipeline {
  const bus = new HookBus();
  const stateStore = new HookStateStore();

  bus.register(sourceClassifyHook, hookConfigs?.["source-classify"]);
  bus.register(createInteragentRoutingHook(stateStore), hookConfigs?.["interagent-routing"]);
  bus.register(riskDetectionHook, hookConfigs?.["risk-detection"]);
  bus.register(createAttemptTracker(stateStore), hookConfigs?.["attempt-tracker"]);
  bus.register(createRoundtableHook(stateStore), hookConfigs?.["roundtable"]);
  bus.register(createAuditScoreHook(stateStore), hookConfigs?.["audit-score"]);
  bus.register(createSupervisionGateHook({ stateStore }), hookConfigs?.["supervision-gate"]);
  bus.register(createPostVerifyHook(), hookConfigs?.["post-verify"]);

  return { bus, stateStore };
}

/**
 * Create a HookBus with the default built-in hooks registered.
 *
 * Backward-compatible wrapper — returns only the HookBus.
 * Use createDefaultPipeline() when you need access to the HookStateStore.
 *
 * Per-hook configs from the profile are applied when provided.
 */
export function createDefaultHookBus(
  hookConfigs?: Record<string, HookConfig>,
): HookBus {
  return createDefaultPipeline(hookConfigs).bus;
}
