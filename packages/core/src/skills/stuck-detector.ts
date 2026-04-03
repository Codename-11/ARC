/**
 * StuckDetector — detects when an agent is repeating similar actions
 * without progress and suggests recovery strategies (Phase 22).
 */

import type { StuckDetection } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tokenize a string into lowercased word tokens. */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 0),
  );
}

/** Jaccard similarity between two sets: |A intersect B| / |A union B|. */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

// ---------------------------------------------------------------------------
// StuckDetector
// ---------------------------------------------------------------------------

interface ActionRecord {
  action: string;
  output: string;
  tokens: Set<string>;
}

export class StuckDetector {
  private config: StuckDetection;
  private history: ActionRecord[] = [];

  constructor(config?: Partial<StuckDetection>) {
    this.config = {
      maxSimilarAttempts: config?.maxSimilarAttempts ?? 3,
      similarityThreshold: config?.similarityThreshold ?? 0.85,
      recoveryStrategies: config?.recoveryStrategies ?? [
        "backtrack",
        "reframe",
        "escalate",
        "abort",
      ],
    };
  }

  /** Record an action and its output for stuck detection. */
  recordAction(action: string, output: string): void {
    const combined = `${action} ${output}`;
    this.history.push({
      action,
      output,
      tokens: tokenize(combined),
    });
  }

  /**
   * Check whether the agent appears stuck.
   *
   * Returns true when the last `maxSimilarAttempts` actions all have
   * pairwise Jaccard similarity above `similarityThreshold`.
   */
  isStuck(): boolean {
    const n = this.config.maxSimilarAttempts;
    if (this.history.length < n) return false;

    const recent = this.history.slice(-n);

    // Check all pairs in the recent window
    for (let i = 0; i < recent.length; i++) {
      for (let j = i + 1; j < recent.length; j++) {
        const sim = jaccardSimilarity(recent[i].tokens, recent[j].tokens);
        if (sim < this.config.similarityThreshold) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Return the next recovery strategy to try.
   *
   * Cycles through configured strategies based on how many times
   * stuck detection has been triggered (inferred from history length).
   */
  getRecoveryStrategy(): string {
    const strategies = this.config.recoveryStrategies;
    if (strategies.length === 0) return "abort";

    // Use the history length to pick progressively stronger strategies
    const stuckCount = Math.floor(
      this.history.length / this.config.maxSimilarAttempts,
    );
    const index = Math.min(stuckCount, strategies.length - 1);
    return strategies[index];
  }

  /** Reset the action history. */
  reset(): void {
    this.history = [];
  }
}
