// Ported from agent-forge/lib/agent-watchdog.ts — see docs/plans/ai-and-roundtable.md AD-7
/**
 * Stall detection for orchestrated agents.
 *
 * Protocol (per Agent-Forge):
 *   - 3 min of no progress → NUDGE (ask the agent to post concrete progress).
 *   - 5 min after nudge   → STALL (emit a decision with kill / wait options).
 *
 * Unlike Agent-Forge's watchdog, this port is pure: it takes injected
 * dependencies in the constructor and exposes a `tick()` method callers
 * invoke on their own schedule. No timers, no I/O — friendly to tests.
 */

// ─── Constants ───────────────────────────────────────────────────────

export const WATCHDOG_NUDGE_AFTER_MS = 180_000;
export const WATCHDOG_STALL_AFTER_MS = 300_000;
export const WATCHDOG_NUDGE_TEXT =
  "Are you still working? Share concrete progress. If no active task remains, mark yourself done instead of repeating an idle status update.";

export const WATCHDOG_STALL_OPTIONS = [
  "Kill agent",
  "Wait 5 min",
  "Wait 15 min",
] as const;

// ─── Low-signal detection (ported verbatim) ──────────────────────────

const LOW_SIGNAL_STATUS_INDICATORS = [
  /\bno active\b.*\b(?:implementation|coding|debugging|investigation|review|task|work)\b.*\b(?:in progress|underway)\b/iu,
  /\b(?:conversation|thread)\s+remains\s+idle\b/iu,
  /\b(?:awaiting|waiting for)\s+(?:a\s+)?(?:concrete|specific)\s+(?:workspace\s+)?task\b/iu,
  /\buser-requested status relays?\b/iu,
  /\bno active implementation\b/iu,
  /\bno active coding\b/iu,
];

const LOW_SIGNAL_SHORT_STATUS_PATTERNS = [
  /^still working[.!]?$/iu,
  /^working on it[.!]?$/iu,
  /^investigating[.!]?$/iu,
  /^looking into it[.!]?$/iu,
  /^status update[.:!]?$/iu,
  /^progress update[.:!]?$/iu,
];

function normalize(content: string): string {
  return content.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Heuristic — returns true if the given message is a "I'm idle, nothing to
 * report" reply. The watchdog treats such replies as non-progress so it keeps
 * nudging/stalling instead of resetting the timer.
 */
export function isLowSignalWatchdogReply(content: string): boolean {
  const normalized = normalize(content);
  if (!normalized) return true;
  if (LOW_SIGNAL_SHORT_STATUS_PATTERNS.some((p) => p.test(normalized))) {
    return true;
  }
  const indicatorCount = LOW_SIGNAL_STATUS_INDICATORS.filter((p) =>
    p.test(normalized),
  ).length;
  if (indicatorCount >= 2) return true;
  return (
    /^(?:current|latest|thread)\s+(?:status|progress)/iu.test(normalized) &&
    indicatorCount >= 1
  );
}

// ─── Event + dep types ───────────────────────────────────────────────

export type WatchdogEventType = "nudge" | "stall" | "decision";

export interface WatchdogEvent {
  type: WatchdogEventType;
  agentId: string;
  timestamp: number;
  text?: string;
  options?: readonly string[];
}

export interface AgentWatchdogDeps {
  /** True iff the agent is currently considered active (not stalled/exited). */
  isAgentActive: (agentId: string) => boolean;
  /** Epoch ms of the agent's last substantive message. */
  getLastMessageAt: (agentId: string) => number;
  /** Deliver a decision prompt to the operator (kill / wait). */
  postDecision: (agentId: string, options: readonly string[]) => void;
  /** Deliver a nudge prompt to the agent. */
  postNudge?: (agentId: string, text: string) => void;
  /** Observer for all lifecycle events. */
  onEvent?: (evt: WatchdogEvent) => void;
  /** Override for tests. */
  now?: () => number;
  /** Override default thresholds. */
  nudgeAfterMs?: number;
  stallAfterMs?: number;
}

interface AgentTrackedState {
  nudgedAt?: number;
  stalledAt?: number;
}

// ─── Watchdog ────────────────────────────────────────────────────────

export class AgentWatchdog {
  private readonly tracked = new Map<string, AgentTrackedState>();
  private readonly now: () => number;
  private readonly nudgeAfterMs: number;
  private readonly stallAfterMs: number;

  constructor(private readonly deps: AgentWatchdogDeps) {
    this.now = deps.now ?? Date.now;
    this.nudgeAfterMs = deps.nudgeAfterMs ?? WATCHDOG_NUDGE_AFTER_MS;
    this.stallAfterMs = deps.stallAfterMs ?? WATCHDOG_STALL_AFTER_MS;
  }

  /** Start tracking an agent. Idempotent. */
  track(agentId: string): void {
    if (!this.tracked.has(agentId)) {
      this.tracked.set(agentId, {});
    }
  }

  /** Stop tracking an agent entirely. */
  forget(agentId: string): void {
    this.tracked.delete(agentId);
  }

  /** Clear nudge/stall markers — e.g., on substantive progress. */
  reset(agentId: string): void {
    if (this.tracked.has(agentId)) {
      this.tracked.set(agentId, {});
    }
  }

  /**
   * Run one evaluation pass across all tracked agents. Emits nudges and
   * stalls via the injected callbacks.
   */
  tick(): WatchdogEvent[] {
    const emitted: WatchdogEvent[] = [];
    const now = this.now();

    for (const [agentId, state] of this.tracked.entries()) {
      if (!this.deps.isAgentActive(agentId)) continue;

      const lastAt = this.deps.getLastMessageAt(agentId);
      if (!Number.isFinite(lastAt)) continue;

      const idleMs = now - lastAt;

      // Nudge at threshold (once).
      if (!state.nudgedAt && idleMs >= this.nudgeAfterMs) {
        state.nudgedAt = now;
        try {
          this.deps.postNudge?.(agentId, WATCHDOG_NUDGE_TEXT);
        } catch {
          // Nudge delivery failure must not halt the watchdog.
        }
        const evt: WatchdogEvent = {
          type: "nudge",
          agentId,
          timestamp: now,
          text: WATCHDOG_NUDGE_TEXT,
        };
        this.safeEmit(evt);
        emitted.push(evt);
        continue;
      }

      // Stall + decision, after nudge, once the stall threshold passes.
      if (state.nudgedAt && !state.stalledAt) {
        const sinceNudge = now - state.nudgedAt;
        if (sinceNudge >= this.stallAfterMs) {
          state.stalledAt = now;
          const stallEvt: WatchdogEvent = {
            type: "stall",
            agentId,
            timestamp: now,
          };
          const decisionEvt: WatchdogEvent = {
            type: "decision",
            agentId,
            timestamp: now,
            options: WATCHDOG_STALL_OPTIONS,
          };
          try {
            this.deps.postDecision(agentId, WATCHDOG_STALL_OPTIONS);
          } catch {
            // Decision delivery failure must not halt the watchdog.
          }
          this.safeEmit(stallEvt);
          this.safeEmit(decisionEvt);
          emitted.push(stallEvt, decisionEvt);
        }
      }
    }

    return emitted;
  }

  /** Snapshot of internal state — mostly for tests. */
  snapshot(): Record<string, AgentTrackedState> {
    const out: Record<string, AgentTrackedState> = {};
    for (const [k, v] of this.tracked.entries()) {
      out[k] = { ...v };
    }
    return out;
  }

  private safeEmit(evt: WatchdogEvent): void {
    try {
      this.deps.onEvent?.(evt);
    } catch {
      // Observer errors must not halt the watchdog.
    }
  }
}
