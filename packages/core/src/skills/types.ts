/**
 * Skill system types for ARC Phase 16.
 *
 * Defines the core Skill, SkillStep, ContractSkill, and ReviewOutput
 * interfaces used across the skill registry, loader, and adapters.
 */

// ---------------------------------------------------------------------------
// Skill steps
// ---------------------------------------------------------------------------

export interface SkillStep {
  action: string;
  description: string;
  conditional?: string;
  onError: "retry" | "skip" | "abort";
}

// ---------------------------------------------------------------------------
// Skill source
// ---------------------------------------------------------------------------

export type SkillSource = "builtin" | "user" | "generated" | "mcp";

// ---------------------------------------------------------------------------
// Core skill
// ---------------------------------------------------------------------------

export interface Skill {
  name: string;
  description: string;
  /** Patterns that activate this skill. */
  trigger: string[];
  steps: SkillStep[];
  /** Required tool names. */
  tools: string[];
  /** Compatible adapter names (empty = all). */
  adapters: string[];
  source: SkillSource;
  created: string;
  lastUsed?: string;
  /** Success rate in the range [0, 1]. */
  successRate: number;
}

// ---------------------------------------------------------------------------
// Contract skills (negative boundaries)
// ---------------------------------------------------------------------------

export interface ContractSkill {
  name: string;
  type: "contract";
  description: string;
  constraints: string[];
  requiredFor: Array<{ riskTier: string }>;
}

// ---------------------------------------------------------------------------
// Structured review output
// ---------------------------------------------------------------------------

export type ReviewVerdict = "approve" | "needs-attention";

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface ReviewFinding {
  severity: FindingSeverity;
  title: string;
  body: string;
  file?: string;
  line_start?: number;
  line_end?: number;
  /** Confidence in the range [0, 1]. */
  confidence: number;
  recommendation: string;
}

export interface ReviewOutput {
  verdict: ReviewVerdict;
  summary: string;
  findings: ReviewFinding[];
  next_steps: string[];
}

// ---------------------------------------------------------------------------
// Stuck detection config (Phase 22)
// ---------------------------------------------------------------------------

export interface StuckDetection {
  /** Maximum similar attempts before flagging stuck. Default: 3. */
  maxSimilarAttempts: number;
  /** Similarity threshold in the range [0, 1]. Default: 0.85. */
  similarityThreshold: number;
  recoveryStrategies: Array<"backtrack" | "reframe" | "escalate" | "abort">;
}
