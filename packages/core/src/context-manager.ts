import { writeLogEvent } from "./logging.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface ContextBudget {
  maxTokens: number;
  compactionThreshold: number;
  keepRecentTurns: number;
  turnsSinceCompaction: number;
}

export interface ContextState {
  turns: ContextTurn[];
  totalTokenEstimate: number;
  compactions: number;
}

export interface ContextTurn {
  role: "user" | "assistant" | "system";
  content: string;
  tokenEstimate: number;
  timestamp: string;
}

// ─── Token estimation ───────────────────────────────────────────────

/**
 * Estimate the token count of `text` using a simple word/4 heuristic.
 * This intentionally over-counts slightly to stay safely under budget.
 */
export function estimateTokens(text: string): number {
  // Split on whitespace; every ~4 characters averages ~1 token.
  // A quick practical approximation: word count * 1.3, plus punctuation weight.
  const words = text.split(/\s+/).filter(Boolean);
  const charEstimate = Math.ceil(text.length / 4);
  // Blend word-count and char-count heuristics.
  return Math.max(1, Math.ceil((words.length + charEstimate) / 2));
}

// ─── Defaults ───────────────────────────────────────────────────────

const DEFAULT_MAX_TOKENS = 100_000;
const DEFAULT_COMPACTION_THRESHOLD = 0.75;
const DEFAULT_KEEP_RECENT_TURNS = 4;

// ─── ContextManager ─────────────────────────────────────────────────

export class ContextManager {
  private turns: ContextTurn[] = [];
  private totalTokenEstimate = 0;
  private compactions = 0;
  private readonly budget: ContextBudget;

  constructor(budget?: Partial<ContextBudget>) {
    this.budget = {
      maxTokens: budget?.maxTokens ?? DEFAULT_MAX_TOKENS,
      compactionThreshold: budget?.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD,
      keepRecentTurns: budget?.keepRecentTurns ?? DEFAULT_KEEP_RECENT_TURNS,
      turnsSinceCompaction: 0,
    };
  }

  /** Append a new turn to the context window. */
  addTurn(role: ContextTurn["role"], content: string): ContextTurn {
    const tokenEstimate = estimateTokens(content);
    const turn: ContextTurn = {
      role,
      content,
      tokenEstimate,
      timestamp: new Date().toISOString(),
    };
    this.turns.push(turn);
    this.totalTokenEstimate += tokenEstimate;
    this.budget.turnsSinceCompaction += 1;
    return turn;
  }

  /** Returns `true` when estimated usage exceeds the compaction threshold. */
  shouldCompact(): boolean {
    const threshold = this.budget.maxTokens * this.budget.compactionThreshold;
    return this.totalTokenEstimate >= threshold;
  }

  /**
   * Compact the context window.
   *
   * Old turns (everything except the most recent `keepRecentTurns`) are
   * concatenated and passed through `summarizer`. The summary replaces
   * those turns as a single system message. Recent turns are kept verbatim.
   */
  async compact(
    summarizer: (text: string) => Promise<string>,
  ): Promise<void> {
    const keep = this.budget.keepRecentTurns;
    if (this.turns.length <= keep) {
      // Nothing old enough to compact.
      return;
    }

    const oldTurns = this.turns.slice(0, this.turns.length - keep);
    const recentTurns = this.turns.slice(this.turns.length - keep);

    // Build a text blob from old turns for the summarizer.
    const oldText = oldTurns
      .map((t) => `[${t.role}] ${t.content}`)
      .join("\n\n");

    const turnsBefore = this.turns.length;
    const tokensBefore = this.totalTokenEstimate;

    const summary = await summarizer(oldText);
    const summaryTokens = estimateTokens(summary);

    const summaryTurn: ContextTurn = {
      role: "system",
      content: summary,
      tokenEstimate: summaryTokens,
      timestamp: new Date().toISOString(),
    };

    this.turns = [summaryTurn, ...recentTurns];
    this.totalTokenEstimate =
      summaryTokens +
      recentTurns.reduce((sum, t) => sum + t.tokenEstimate, 0);
    this.compactions += 1;
    this.budget.turnsSinceCompaction = 0;

    const tokensSaved = tokensBefore - this.totalTokenEstimate;

    writeLogEvent({
      level: "info",
      component: "context-manager",
      action: "compaction",
      message: `Compacted ${turnsBefore} turns to ${this.turns.length} (saved ~${tokensSaved} tokens)`,
      data: {
        turnsBefore,
        turnsAfter: this.turns.length,
        tokensBefore,
        tokensAfter: this.totalTokenEstimate,
        tokensSaved,
        compactions: this.compactions,
      },
    });
  }

  /** Return a shallow copy of the current turns. */
  getTurns(): ContextTurn[] {
    return [...this.turns];
  }

  /** Return a snapshot of the current context state. */
  getState(): ContextState {
    return {
      turns: [...this.turns],
      totalTokenEstimate: this.totalTokenEstimate,
      compactions: this.compactions,
    };
  }
}
