import type { Profile, EnforcementMode, HookConfig } from "../types.js";

// Re-export so consumers can import from hooks/types
export type { EnforcementMode, HookConfig };

// ─── Hook events ─────────────────────────────────────────────────────

/** When a hook fires in the pipeline lifecycle. */
export type HookEvent = "pre-message" | "post-message" | "pre-launch" | "post-launch";

// ─── Classification types ────────────────────────────────────────────

/** Origin of the message being processed. */
export type MessageSource = "user" | "system" | "cron" | "agent" | "unknown";

/**
 * 5-tier risk classification per supervisor-patterns.md.
 * Ordered from lowest to highest risk.
 */
export type RiskTier =
  | "read-only"
  | "file-modification"
  | "build-affecting"
  | "deploy-affecting"
  | "destructive";

/** Full risk classification result from classifyRisk(). */
export interface RiskClassification {
  tier: RiskTier;
  reasons: string[];
  requiresConfirmation: boolean;
  checklistIntensity: "light" | "standard" | "strict";
}

// ─── Hook result & metadata ──────────────────────────────────────────

/** Arbitrary metadata for hook injection. */
export type HookMetadata = Record<string, unknown>;

/** Result returned by a hook's check() method. */
export interface HookResult {
  /** Whether the check passed. */
  pass: boolean;
  /** Optional flag for advisory notices. */
  flag?: string;
  /** If true, the pipeline should block (respected only in 'enforce' mode). */
  block?: boolean;
  /** Human-readable reason for the result. */
  reason?: string;
  /** Risk tier assigned by this hook, if applicable. */
  tier?: RiskTier;
  /** Arbitrary metadata to pass downstream. */
  metadata?: HookMetadata;
}

// ─── Hook context ────────────────────────────────────────────────────

/**
 * Context passed into hook check/inject/postProcess methods.
 * Extends the placeholder HookContext from adapters/types with richer fields.
 */
export interface HookContext {
  message: string;
  sessionId: string;
  profile: Profile;
  adapter: string;
  /** Source classification, populated by source-classify hook. */
  source?: MessageSource;
  /** Risk tier, populated by risk-detection hook. */
  riskTier?: RiskTier;
  /** Accumulated metadata from prior hooks in the pipeline. */
  hookMetadata?: HookMetadata;
}

/** Response object for post-processing hooks. */
export interface AgentResponse {
  content: string;
  toolCalls?: unknown[];
}

// ─── Hook interface ──────────────────────────────────────────────────

/**
 * A hook that participates in the ARC supervision pipeline.
 * Hooks are registered on a HookBus and run in priority order (ascending).
 */
export interface Hook {
  /** Unique name identifying this hook. */
  name: string;
  /** Which pipeline events this hook subscribes to. */
  events: HookEvent[];
  /** Execution priority — lower numbers run first. */
  priority: number;
  /**
   * Run the hook's check logic.
   * May be sync or async — the bus wraps it with Promise.race for timeout.
   */
  check(ctx: HookContext): HookResult | Promise<HookResult>;
  /** Optionally inject metadata for downstream hooks/adapter. */
  inject?(ctx: HookContext): HookMetadata | undefined;
  /** Optionally post-process an agent response. */
  postProcess?(ctx: HookContext, response: AgentResponse): Promise<void>;
}

// ─── Pipeline aggregation ────────────────────────────────────────────

/** Aggregated result from running the pre-message hook pipeline. */
export interface PreHookPipelineResult {
  results: HookResult[];
  blocked: boolean;
  metadata: HookMetadata;
}
