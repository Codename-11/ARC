export * from "./config.js";
export * from "./health.js";
export * from "./import-utils.js";
export * from "./keyring.js";
export * from "./lifecycle.js";
export * from "./logging.js";
export * from "./paths.js";
export * from "./process.js";

// shared-fs: exclude deepMerge (conflicts with shared-layer's deepMerge)
export {
  readJsonObject,
  writeJsonObject,
  isDirectoryLink,
  createDirectoryLink,
  removeDirectoryLink,
} from "./shared-fs.js";
export { deepMerge } from "./shared-fs.js";

// shared-layer: exclude deepMerge (re-exported from shared-fs above)
export {
  getSharedManifest,
  syncSharedLayer,
  unsyncSharedLayer,
  pullProfileIntoShared,
  type SharedLayerSyncOptions,
  type SharedLayerPullResult,
} from "./shared-layer.js";

// types: exclude HealthStatus, HealthCheck, HealthReport (authoritative in health.ts)
//        exclude LogLevel, LogEvent (authoritative in logging.ts)
//        EnforcementMode, HookConfig now live here (used by Profile)
export type {
  AuthType,
  AgentTool,
  Profile,
  ArcSettings,
  ArcConfig,
  SharedManifest,
  EnforcementMode,
  HookConfig,
} from "./types.js";

export * from "./adapters/types.js";

// hooks: named exports to avoid collisions with adapters/types.ts placeholders
//        (HookContext, HookMetadata, AgentResponse exist in both — adapters/types owns the barrel export,
//         hooks/types owns the richer versions, importable via @axiom-labs/arc-core/hooks)
export {
  HookBus,
  createDefaultHookBus,
  createDefaultPipeline,
  sourceClassifyHook,
  riskDetectionHook,
  classifyRisk,
  HookStateStore,
  createAttemptTracker,
  interagentRoutingHook,
  auditCompletion,
  createAuditScoreHook,
  runWithRetry,
} from "./hooks/index.js";
export type {
  HookEvent,
  MessageSource,
  RiskTier,
  RiskClassification,
  HookResult,
  Hook,
  PreHookPipelineResult,
  CompletionAudit,
  AttemptTrackerOptions,
  LLMCompleteFn,
  AuditCompletionOptions,
  DefaultPipeline,
  RunWithRetryOptions,
  RunWithRetryResult,
} from "./hooks/index.js";

// shared.ts wrappers (convenience layer over shared-layer + shared-fs)
export {
  getSharedSettings,
  getSharedSourceTool,
  syncSharedToProfile,
  unsyncSharedFromProfile,
  pullProfileToShared,
  type PullResult,
} from "./shared.js";
