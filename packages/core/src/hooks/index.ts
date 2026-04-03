// Hook system barrel — re-exports all hook types, HookBus, concrete hooks, and utilities.

export type {
  EnforcementMode,
  HookConfig,
  HookEvent,
  MessageSource,
  RiskTier,
  RiskClassification,
  HookMetadata,
  HookResult,
  HookContext,
  AgentResponse,
  Hook,
  PreHookPipelineResult,
} from "./types.js";

export { HookBus } from "./hook-bus.js";
export { sourceClassifyHook } from "./source-classify.js";
export { riskDetectionHook } from "./risk-detection.js";
export { classifyRisk } from "./risk-classifier.js";
