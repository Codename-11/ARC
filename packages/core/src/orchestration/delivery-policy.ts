// Ported from agent-forge/lib/agent-delivery.ts — see docs/plans/ai-and-roundtable.md AD-7
/**
 * Adaptive delivery pacing for the roundtable orchestrator.
 *
 * Each model family (Gemini, Claude, Codex, default) has a built-in profile
 * with min/max grace periods and an adaptive multiplier. The orchestrator
 * tracks a rolling EMA of observed reply latency per agent and uses it to
 * compute the next "grace" pause between turns — faster agents breathe less,
 * slower ones get a longer runway so the group stays in rhythm.
 *
 * Coalescing helpers and a tiny priority queue are exposed for message
 * batching when multiple pending messages target the same agent.
 */

import type { AgentTool } from "../types.js";

// ─── Constants ───────────────────────────────────────────────────────

const DEFAULT_MIN_REPLY_GRACE_MS = 10_000;
const DEFAULT_MAX_REPLY_GRACE_MS = 90_000;
const DEFAULT_ADAPTIVE_REPLY_MULTIPLIER = 1.3;
const DEFAULT_BROADCAST_COALESCE_WINDOW_MS = 12_000;

// EMA weights — 70% weight on previous observation, 30% on new sample.
const EMA_PREVIOUS_WEIGHT = 0.7;
const EMA_SAMPLE_WEIGHT = 0.3;

// ─── Types ───────────────────────────────────────────────────────────

/**
 * Delivery policy governing how aggressively the orchestrator paces turns
 * between agents. All durations are in milliseconds.
 */
export interface AgentDeliveryPolicy {
  /** Lower bound on between-turn grace. Fast agents still wait this long. */
  minReplyGraceMs: number;
  /** Upper bound on between-turn grace. Slow agents never block longer. */
  maxReplyGraceMs: number;
  /** Multiplier applied to the rolling EMA latency when computing grace. */
  adaptiveReplyMultiplier: number;
  /** Window within which adjacent broadcasts are candidates to coalesce. */
  broadcastCoalesceWindowMs: number;
  /** When false, pacing is disabled entirely (grace = 0). */
  respectAgentPace: boolean;
  /** When true, direct (non-broadcast) messages bypass pacing. */
  directMessageBypass: boolean;
}

/** EMA-tracked latency state, per agent. */
export interface DeliveryState {
  /** Rolling latency average — milliseconds. 0 means no samples yet. */
  observedLatencyMs: number;
  /** Number of samples folded into the EMA. */
  sampleCount: number;
}

export type MessagePriority = "urgent" | "normal" | "low";

/** Simple priority-queue entry for coalescing pending messages. */
export interface PriorityQueueItem {
  text: string;
  priority: MessagePriority;
  createdAt: number;
}

// ─── Built-in model profiles ─────────────────────────────────────────

const GEMINI_PROFILE: AgentDeliveryPolicy = {
  minReplyGraceMs: 18_000,
  maxReplyGraceMs: 120_000,
  adaptiveReplyMultiplier: 1.6,
  broadcastCoalesceWindowMs: 20_000,
  respectAgentPace: true,
  directMessageBypass: true,
};

const CLAUDE_PROFILE: AgentDeliveryPolicy = {
  minReplyGraceMs: 12_000,
  maxReplyGraceMs: 90_000,
  adaptiveReplyMultiplier: 1.45,
  broadcastCoalesceWindowMs: 14_000,
  respectAgentPace: true,
  directMessageBypass: true,
};

const CODEX_PROFILE: AgentDeliveryPolicy = {
  minReplyGraceMs: 8_000,
  maxReplyGraceMs: 60_000,
  adaptiveReplyMultiplier: 1.2,
  broadcastCoalesceWindowMs: 8_000,
  respectAgentPace: true,
  directMessageBypass: true,
};

const DEFAULT_PROFILE: AgentDeliveryPolicy = {
  minReplyGraceMs: DEFAULT_MIN_REPLY_GRACE_MS,
  maxReplyGraceMs: DEFAULT_MAX_REPLY_GRACE_MS,
  adaptiveReplyMultiplier: DEFAULT_ADAPTIVE_REPLY_MULTIPLIER,
  broadcastCoalesceWindowMs: DEFAULT_BROADCAST_COALESCE_WINDOW_MS,
  respectAgentPace: true,
  directMessageBypass: true,
};

// ─── Helpers ─────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ─── Public API ──────────────────────────────────────────────────────

/** Fresh EMA state, no samples observed yet. */
export function createDeliveryState(): DeliveryState {
  return { observedLatencyMs: 0, sampleCount: 0 };
}

/**
 * Compute the next between-turn grace period given the current EMA state
 * and the active policy. Pure function — no side effects.
 *
 * Semantics:
 *   - policy.respectAgentPace === false → returns 0
 *   - no samples yet                     → returns policy.minReplyGraceMs
 *   - otherwise                          → clamp(observed * multiplier, min, max)
 */
export function computeAdaptiveGraceMs(
  policy: AgentDeliveryPolicy,
  state: DeliveryState,
): number {
  if (!policy.respectAgentPace) return 0;
  if (state.sampleCount <= 0 || !(state.observedLatencyMs > 0)) {
    return policy.minReplyGraceMs;
  }
  const projected = state.observedLatencyMs * policy.adaptiveReplyMultiplier;
  return clamp(projected, policy.minReplyGraceMs, policy.maxReplyGraceMs);
}

/**
 * Fold a new latency sample into the EMA state.
 *
 * First sample seeds the EMA; subsequent samples decay prior state 70%
 * and blend the new sample at 30%. Invalid samples (≤0 or non-finite)
 * are ignored.
 */
export function updateReplyLatencyAverage(
  state: DeliveryState,
  newLatencyMs: number,
): DeliveryState {
  if (!Number.isFinite(newLatencyMs) || newLatencyMs <= 0) return state;
  if (state.sampleCount <= 0 || state.observedLatencyMs <= 0) {
    return { observedLatencyMs: Math.round(newLatencyMs), sampleCount: 1 };
  }
  const blended =
    state.observedLatencyMs * EMA_PREVIOUS_WEIGHT +
    newLatencyMs * EMA_SAMPLE_WEIGHT;
  return {
    observedLatencyMs: Math.round(blended),
    sampleCount: state.sampleCount + 1,
  };
}

/** Dispatch the right built-in policy for a tool identifier. */
export function resolveDeliveryPolicyForTool(
  tool: AgentTool | undefined,
): AgentDeliveryPolicy {
  if (!tool) return { ...DEFAULT_PROFILE };
  const key = tool.toLowerCase();
  if (key.includes("gemini")) return { ...GEMINI_PROFILE };
  if (key.includes("claude")) return { ...CLAUDE_PROFILE };
  if (key.includes("codex")) return { ...CODEX_PROFILE };
  return { ...DEFAULT_PROFILE };
}

// ─── Priority queue (coalescing) ─────────────────────────────────────

const PRIORITY_ORDER: Record<MessagePriority, number> = {
  urgent: 0,
  normal: 1,
  low: 2,
};

/**
 * Minimal priority queue for message coalescing. Stable FIFO within a
 * priority level; higher-priority items drain first.
 *
 * Not thread-safe — intended for use from a single orchestrator loop.
 */
export class MessagePriorityQueue {
  private readonly items: PriorityQueueItem[] = [];

  enqueue(item: PriorityQueueItem): void {
    this.items.push(item);
    this.items.sort((a, b) => {
      const dp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (dp !== 0) return dp;
      return a.createdAt - b.createdAt;
    });
  }

  dequeue(): PriorityQueueItem | undefined {
    return this.items.shift();
  }

  peek(): PriorityQueueItem | undefined {
    return this.items[0];
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }

  /** Snapshot (defensive copy) of all pending items. */
  snapshot(): PriorityQueueItem[] {
    return [...this.items];
  }
}
