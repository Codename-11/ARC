/**
 * ARC knowledge layer — static domain knowledge + runtime prompt composer
 * powering the in-app AI assistant (AD-6 Phase 3).
 */

export {
  ARC_KNOWLEDGE,
  COMMANDS_CATALOG,
  type ArcKnowledge,
  type CommandDoc,
  type CommandCategory,
} from "./static.js";

export {
  FEATURES_INDEX,
  getFeature,
  getFeaturesByStatus,
  type FeatureEntry,
  type FeatureStatus,
} from "./feature-index.js";

// NOTE: estimateTokens is intentionally NOT re-exported here — the
// canonical `estimateTokens` lives in context-manager.ts and is already
// re-exported by packages/core/src/index.ts.
// PermissionMode and LaunchHistoryEntry are also owned by other modules
// (agent/ and history.ts respectively); import from ./runtime.js directly
// if you need the knowledge-layer-specific helpers.
export {
  buildSystemPrompt,
  type KnowledgeContext,
} from "./runtime.js";
