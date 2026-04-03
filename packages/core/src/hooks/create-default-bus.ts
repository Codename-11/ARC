import type { HookConfig } from "./types.js";
import { HookBus } from "./hook-bus.js";
import { sourceClassifyHook } from "./source-classify.js";
import { riskDetectionHook } from "./risk-detection.js";

/**
 * Create a HookBus with the default built-in hooks registered.
 *
 * This is the composition point — future slices add hooks here.
 * Per-hook configs from the profile are applied when provided.
 *
 * Default hooks (in priority order):
 *   1. source-classify  (priority 1)  — assigns MessageSource
 *  10. risk-detection    (priority 10) — classifies 5-tier risk
 */
export function createDefaultHookBus(
  hookConfigs?: Record<string, HookConfig>
): HookBus {
  const bus = new HookBus();

  bus.register(sourceClassifyHook, hookConfigs?.["source-classify"]);
  bus.register(riskDetectionHook, hookConfigs?.["risk-detection"]);

  return bus;
}
