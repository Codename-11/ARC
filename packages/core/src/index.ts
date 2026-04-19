export * from "./circuit-breaker.js";
export * from "./config.js";
export * from "./health.js";
export * from "./workspace.js";
export * from "./import-utils.js";
export * from "./keyring.js";
export * from "./secrets/index.js";
export * from "./history.js";
export * from "./agent-client/index.js";
export * from "./agent/index.js";
export * from "./knowledge/index.js";
export * from "./chat/index.js";
export * from "./orchestration/index.js";
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
  ProviderConfig,
  ProviderExtends,
  ArcSettings,
  ArcConfig,
  SharedManifest,
  EnforcementMode,
  HookConfig,
} from "./types.js";

// Provider presets (Claude, Codex, Gemini, OpenCode — extends-style)
export {
  providerPresets,
  listProviderPresets,
  getProviderPreset,
} from "./provider-presets.js";

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
  createInteragentRoutingHook,
  interagentRoutingHook,
  auditCompletion,
  createAuditScoreHook,
  createRoundtableHook,
  runWithRetry,
  createSupervisionGateHook,
  isSubstantive,
  parseGateResponse,
  createPostVerifyHook,
  detectServiceOperation,
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
  RoundtableOptions,
  RoundtableState,
  RunWithRetryOptions,
  RunWithRetryResult,
  GateReviewContext,
  SupervisionGateOptions,
  PostVerifyOptions,
  HealthCheckResult,
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

// Phase 20 — Three-Tier Permission Model
export {
  createPermissionPolicy,
  evaluatePermission,
  COORDINATOR_DEFAULTS,
  INTERACTIVE_DEFAULTS,
  WORKER_DEFAULTS,
  type PermissionPolicy,
  type PermissionDecision,
} from "./permissions.js";

// Phase 19 — Context Management
export {
  ContextManager,
  estimateTokens,
  type ContextBudget,
  type ContextState,
  type ContextTurn,
} from "./context-manager.js";

// Phase 21 — Semantic Phase Indicators
export {
  detectPhase,
  getPhaseVerb,
  getPhaseCompletionVerb,
  type AgentPhase,
} from "./phase-indicators.js";

// Phase 16.2 — Streaming Event Taxonomy
export {
  StreamEventBus,
  type StreamEvent,
  type StreamEventType,
  type StreamEventOf,
  type StreamEventHandler,
} from "./stream-events.js";

// Phase 15 — Memory System
export {
  SessionMemory,
  PersistentMemory,
  decayScore,
  isExpired,
  searchMemories,
  extractMemories,
  type MemoryEntry,
  type MemoryType,
  type MemoryScope,
  type MemorySearchOptions,
  type MemoryPruneOptions,
  type MemoryStore,
} from "./memory/index.js";

// Phase 16 — Skill System (+ Phase 22 skillify/stuck-detector)
export {
  loadSkillsFromDirectory,
  SkillRegistry,
  mcpToSkill,
  detectRepeatedPatterns,
  generateSkillFromPattern,
  StuckDetector,
} from "./skills/index.js";
export type {
  Skill,
  SkillStep,
  SkillSource,
  ContractSkill,
  ReviewVerdict,
  FindingSeverity,
  ReviewFinding,
  ReviewOutput,
  StuckDetection,
} from "./skills/index.js";

// Phase 17 — Task Management
export {
  TaskStore,
  MessageBus,
  CronStore,
  CronScheduler,
  parseCronExpression,
} from "./tasks/index.js";
export type {
  Task,
  TaskStatus,
  TaskPriority,
  AgentMessage,
  MessageType,
  CronJob,
  TaskListFilters,
  TaskCreateOptions,
  MessageHandler,
  SendOptions,
} from "./tasks/index.js";

// Phase 11 — Cloud Sync
export {
  FilesystemSyncProvider,
  SyncManager,
  type SyncConfig,
  type SyncProvider,
  type SyncDelta,
  type SyncChange,
  type SyncStatus,
} from "./sync/index.js";

// Phase 23 — Plugin Registry
export {
  PluginRegistry,
  type PluginManifest,
  type PluginCapability,
  type InstalledPlugin,
} from "./plugins/index.js";

// Phase 18 — Session Continuity
export {
  SessionStore,
  isResumeIntent,
  type SessionThread,
  type SessionStatus,
  type SessionFilter,
} from "./sessions.js";

// Phase 24 — Remote Agent Support
export {
  RemoteAgentRegistry,
  checkHealth,
  type RemoteAgent,
  type RemoteAgentConfig,
  type RemoteAgentTransport,
  type RemoteAgentStatus,
} from "./remote.js";

// Phase 25 — Dark Factory Mode
export {
  FactoryController,
  type FactorySpec,
  type FactoryWave,
  type FactoryTask,
  type FactoryStatus,
  type FactoryState,
  type FactoryWaveResult,
} from "./factory.js";

// Phase 13 — OpenTelemetry Integration
export {
  TelemetryProvider,
  ConsoleExporter,
  JsonFileExporter,
  OtlpExporter,
  startSessionSpan,
  startPreflightSpan,
  startHookSpan,
  startAgentExecutionSpan,
  startToolUseSpan,
  startPostflightSpan,
  startCircuitBreakerSpan,
  type SpanAttributes,
  type SpanEvent,
  type SpanStatus,
  type Span,
  type TraceExporter,
  type TelemetryConfig,
} from "./telemetry/index.js";
