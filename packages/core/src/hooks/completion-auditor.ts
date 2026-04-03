import type { AgentResponse, CompletionAudit } from "./types.js";

// ─── Signal patterns ─────────────────────────────────────────────────

/** Patterns indicating explicit completion. Case-insensitive matching. */
const COMPLETION_SIGNALS = [
  "done",
  "completed",
  "finished",
  "success",
  "all tests pass",
];

/** Patterns indicating failure or contradiction. */
const FAILURE_SIGNALS = [
  "failed",
  "error",
  "exception",
  "unable",
  "cannot",
];

/** Patterns indicating contradiction within an otherwise positive response. */
const CONTRADICTION_SIGNALS = [
  "but",
  "however",
];

/** Patterns indicating overreach beyond original scope. */
const OVERREACH_SIGNALS = [
  "also",
  "additionally",
  "went ahead and",
];

// ─── LLM placeholder ────────────────────────────────────────────────

/**
 * Signature for an LLM completion function. Not used in v1 —
 * exists as a placeholder for M004's LLM-backed audit.
 */
export type LLMCompleteFn = (ctx: string) => Promise<string>;

export interface AuditCompletionOptions {
  /** LLM function for enhanced audit. Not called in v1. */
  llmComplete?: LLMCompleteFn;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Case-insensitive word-boundary-ish match. Uses \\b for whole-word matching on single words, plain includes for phrases. */
function hasSignal(text: string, signal: string): boolean {
  // For multi-word phrases, use simple includes
  if (signal.includes(" ")) {
    return text.includes(signal);
  }
  // For single words, use word boundary to avoid false matches (e.g., "but" in "button")
  const re = new RegExp(`\\b${signal}\\b`, "i");
  return re.test(text);
}

function countMatches(text: string, signals: string[]): number {
  return signals.filter((s) => hasSignal(text, s)).length;
}

function matchedSignals(text: string, signals: string[]): string[] {
  return signals.filter((s) => hasSignal(text, s));
}

// ─── Core function ───────────────────────────────────────────────────

/**
 * Deterministic completion audit on an agent response.
 *
 * Examines `response.content` for completion, failure, contradiction,
 * and overreach signals. Produces a CompletionAudit with status,
 * confidence, and a recommendation per the status×confidence matrix
 * from supervisor-patterns.md §6.2.
 */
export function auditCompletion(
  response: AgentResponse,
  _opts?: AuditCompletionOptions,
): CompletionAudit {
  const content = (response.content ?? "").toLowerCase();
  const trimmed = content.trim();

  // ── Signal detection ───────────────────────────────────────────

  const completionHits = matchedSignals(trimmed, COMPLETION_SIGNALS);
  const failureHits = matchedSignals(trimmed, FAILURE_SIGNALS);
  const contradictionHits = matchedSignals(trimmed, CONTRADICTION_SIGNALS);
  const overreachHits = matchedSignals(trimmed, OVERREACH_SIGNALS);

  const hasCompletion = completionHits.length > 0;
  const hasFailure = failureHits.length > 0;
  const hasContradiction = contradictionHits.length > 0;
  const overreachDetected = overreachHits.length > 0;

  // ── Status determination ───────────────────────────────────────

  let status: CompletionAudit["status"];

  if (trimmed.length === 0) {
    status = "uncertain";
  } else if (hasFailure && !hasCompletion) {
    // Explicit failure with no completion signals
    status = "failed";
  } else if (hasCompletion && (hasFailure || hasContradiction)) {
    // Mixed signals — both completion and failure/contradiction
    status = "partial";
  } else if (hasCompletion) {
    // Clean completion signals with no contradictions
    status = "complete";
  } else {
    status = "uncertain";
  }

  // ── Confidence scoring ─────────────────────────────────────────
  // Base 0.5 for having any content
  // +0.2 for completion signals
  // -0.1 per contradiction/failure found
  // Clamped to [0, 1]

  let confidence: number;

  if (trimmed.length === 0) {
    confidence = 0;
  } else {
    confidence = 0.5;
    if (hasCompletion) confidence += 0.2;
    const negativeCount = contradictionHits.length + failureHits.length;
    confidence -= negativeCount * 0.1;
    confidence = Math.max(0, Math.min(1, confidence));
  }

  // ── Checks passed/failed ───────────────────────────────────────

  const checksPassed: string[] = [];
  const checksFailed: string[] = [];

  if (trimmed.length > 0) checksPassed.push("has-content");
  else checksFailed.push("has-content");

  if (hasCompletion) checksPassed.push("completion-signals");
  else checksFailed.push("completion-signals");

  if (!hasFailure) checksPassed.push("no-failure-signals");
  else checksFailed.push("no-failure-signals");

  if (!hasContradiction) checksPassed.push("no-contradictions");
  else checksFailed.push("no-contradictions");

  if (!overreachDetected) checksPassed.push("no-overreach");
  else checksFailed.push("no-overreach");

  // ── Recommendation matrix (supervisor-patterns.md §6.2) ────────
  //   complete + any         → 'complete'
  //   partial  + any         → 'continue'
  //   failed   + conf ≥ 0.3  → 'retry'
  //   failed   + conf < 0.3  → 'escalate'
  //   uncertain + conf ≥ 0.3 → 'continue'
  //   uncertain + conf < 0.3 → 'escalate'

  let recommendation: CompletionAudit["recommendation"];

  switch (status) {
    case "complete":
      recommendation = "complete";
      break;
    case "partial":
      recommendation = "continue";
      break;
    case "failed":
      recommendation = confidence >= 0.3 ? "retry" : "escalate";
      break;
    case "uncertain":
      recommendation = confidence >= 0.3 ? "continue" : "escalate";
      break;
  }

  return {
    status,
    checksPassed,
    checksFailed,
    missingSteps: [], // v1: no task-spec comparison — placeholder for M004
    overreachDetected,
    confidence,
    recommendation,
  };
}
