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
  CompletionAudit,
} from "./types.js";

export { HookBus } from "./hook-bus.js";
export { HookStateStore } from "./hook-state.js";
export { createDefaultHookBus, createDefaultPipeline } from "./create-default-bus.js";
export type { DefaultPipeline } from "./create-default-bus.js";
export { sourceClassifyHook } from "./source-classify.js";
export { riskDetectionHook } from "./risk-detection.js";
export { classifyRisk } from "./risk-classifier.js";
export { createAttemptTracker } from "./attempt-tracker.js";
export type { AttemptTrackerOptions } from "./attempt-tracker.js";
export { interagentRoutingHook } from "./interagent-routing.js";
export { auditCompletion } from "./completion-auditor.js";
export type { LLMCompleteFn, AuditCompletionOptions } from "./completion-auditor.js";
export { createAuditScoreHook } from "./audit-score.js";
export { runWithRetry } from "./retry-loop.js";
export type { RunWithRetryOptions, RunWithRetryResult } from "./retry-loop.js";
export { createSupervisionGateHook, isSubstantive, parseGateResponse } from "./supervision-gate.js";
export type { GateReviewContext, SupervisionGateOptions } from "./supervision-gate.js";
export { createPostVerifyHook, detectServiceOperation } from "./post-verify.js";
export type { PostVerifyOptions, HealthCheckResult } from "./post-verify.js";
