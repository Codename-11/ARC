import { writeLogEvent } from "../logging.js";
import type {
  Hook,
  HookContext,
  HookResult,
  HookMetadata,
  AgentResponse,
  EnforcementMode,
} from "./types.js";
import type { HookStateStore } from "./hook-state.js";

// ─── Public interfaces ───────────────────────────────────────────────

/** Per-agent discussion mode assigned when a roundtable is created. */
export type AgentMode = "critic" | "advocate" | "neutral";

/** Persisted state for an active roundtable discussion. */
export interface RoundtableState {
  /** Unique identifier for this roundtable session. */
  id: string;
  /** The discussion topic extracted from the trigger message. */
  topic: string;
  /** Ordered list of participating agent adapter names (deduplicated). */
  agents: string[];
  /** Assigned mode per agent. */
  modes: Record<string, AgentMode>;
  /** Total number of discussion rounds. */
  rounds: number;
  /** Current round (1-indexed). */
  currentRound: number;
  /** Index into `agents` for whose turn it is (0-indexed). */
  currentTurnIndex: number;
  /** Accumulated responses across all rounds. */
  responses: Array<{ agent: string; round: number; content: string }>;
  /** Lifecycle status. */
  status: "active" | "synthesizing" | "complete";
  /** ISO-8601 timestamp when the roundtable was created. */
  startedAt: string;
}

/** Options accepted by the createRoundtableHook factory. */
export interface RoundtableOptions {
  /**
   * Default number of discussion rounds when the trigger does not specify one.
   * @default 2
   */
  defaultRounds?: number;
  /**
   * Default set of agents to include when the trigger message does not list any.
   * If empty the hook will pull the single adapter from `ctx.adapter`.
   */
  defaultAgents?: string[];
  /**
   * Default mode to assign agents that are not the first two.
   * @default "neutral"
   */
  defaultMode?: AgentMode;
}

// ─── Constants ───────────────────────────────────────────────────────

const HOOK_NAME = "roundtable";
const STATE_KEY = "roundtableState";
const COMPONENT = `hook:${HOOK_NAME}`;

/**
 * Trigger patterns — any match starts a new roundtable.
 * Case-insensitive, word-boundary aware where practical.
 */
const TRIGGER_PATTERNS: RegExp[] = [
  /\b(?:let['\u2018\u2019]?s\s+discuss)\b/i,
  /\b(?:roundtable)\s*:/i,
  /@roundtable\b/i,
  /\b(?:debate\s+this)\b/i,
];

// ─── Helpers ─────────────────────────────────────────────────────────

/** Returns true if the message matches any trigger phrase. */
function isTrigger(message: string): boolean {
  return TRIGGER_PATTERNS.some((re) => re.test(message));
}

/**
 * Parse agent list from the trigger message.
 *
 * Supports:
 *   - `agents: a, b, c`
 *   - `agents: a b c`
 *
 * The `with` keyword is intentionally NOT matched to avoid false positives
 * (e.g., "working with APIs" would misparse "APIs" as an agent).
 *
 * Returns an empty array when nothing is found (caller falls back to defaults).
 */
function parseAgents(message: string): string[] {
  const agentsMatch = message.match(/agents\s*:\s*([^\n]+)/i);
  if (!agentsMatch) return [];

  return agentsMatch[1]
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse the number of rounds from the trigger message.
 * Example: "rounds: 3" or "3 rounds".
 * Returns undefined when not found (caller falls back to default).
 */
function parseRounds(message: string): number | undefined {
  const explicit = message.match(/rounds\s*:\s*(\d+)/i);
  if (explicit) return parseInt(explicit[1], 10);

  const inline = message.match(/(\d+)\s+rounds?\b/i);
  if (inline) return parseInt(inline[1], 10);

  return undefined;
}

/**
 * Extract the discussion topic from the trigger message.
 * Strips known trigger keywords and metadata (agents:, rounds:) to leave the
 * core topic text.
 */
function parseTopic(message: string): string {
  let topic = message
    .replace(/@roundtable\b/gi, "")
    .replace(/\broundtable\s*:/i, "")
    .replace(/\b(?:let['\u2018\u2019]?s\s+discuss)\b/i, "")
    .replace(/\b(?:debate\s+this)\b/i, "")
    .replace(/agents\s*:[^\n]*/i, "")
    .replace(/rounds\s*:\s*\d+/i, "")
    .replace(/\d+\s+rounds?\b/i, "")
    .trim();

  // Collapse whitespace
  topic = topic.replace(/\s+/g, " ");

  return topic || "general discussion";
}

/** Deduplicate an array while preserving order. */
function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

/** Generate a simple unique identifier. */
function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `rt-${ts}-${rand}`;
}

/**
 * Assign modes to agents. First agent gets advocate, second gets critic,
 * rest get the configured default mode.
 */
function assignModes(
  agents: string[],
  defaultMode: AgentMode,
): Record<string, AgentMode> {
  const modes: Record<string, AgentMode> = {};
  for (const agent of agents) {
    modes[agent] = defaultMode;
  }
  if (agents.length >= 2) {
    modes[agents[0]] = "advocate";
    modes[agents[1]] = "critic";
  }
  return modes;
}

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Factory — creates a roundtable multi-agent discussion hook.
 *
 * Priority 50, pre-message + post-message:
 *   - `check()` fires on pre-message: detects triggers, manages turn order.
 *   - `postProcess()` fires on post-message: records responses, advances turns.
 *   - `inject()` provides downstream hooks/adapters with roundtable metadata.
 *
 * Enforcement modes:
 *   - `log`     — track state, log turn order, never block.
 *   - `advise`  — inject turn-order suggestions via metadata.
 *   - `enforce` — block out-of-turn messages.
 */
export function createRoundtableHook(
  stateStore: HookStateStore,
  options?: RoundtableOptions,
): Hook {
  const defaultRounds = options?.defaultRounds ?? 2;
  const defaultAgents = options?.defaultAgents ?? [];
  const defaultMode: AgentMode = options?.defaultMode ?? "neutral";

  // ── State helpers ────────────────────────────────────────────────

  function getState(sessionId: string): RoundtableState | undefined {
    return stateStore.get<RoundtableState>(sessionId, HOOK_NAME, STATE_KEY);
  }

  function setState(sessionId: string, state: RoundtableState): void {
    stateStore.set(sessionId, HOOK_NAME, STATE_KEY, state);
  }

  // ── Hook object ──────────────────────────────────────────────────

  return {
    name: HOOK_NAME,
    events: ["pre-message", "post-message"],
    priority: 50,

    // ─── check (fires on pre-message only — HookBus.runPost calls postProcess, not check) ───

    check(ctx: HookContext): HookResult {
      const enforcement: EnforcementMode = ctx.profile.enforcement ?? "log";
      const existing = getState(ctx.sessionId);

      // ── Trigger while roundtable already active — warn and ignore ──
      if (existing && existing.status !== "complete" && isTrigger(ctx.message)) {
        writeLogEvent({
          level: "warn",
          component: COMPONENT,
          action: "trigger-ignored",
          message: `Roundtable '${existing.id}' already active — ignoring new trigger`,
          data: {
            activeId: existing.id,
            activeStatus: existing.status,
            sessionId: ctx.sessionId,
          },
        });

        return {
          pass: true,
          flag: `Roundtable '${existing.id}' is already active — new trigger ignored`,
          metadata: {
            roundtable: true,
            roundtableId: existing.id,
            triggerIgnored: true,
          },
        };
      }

      // ── New trigger detection ─────────────────────────────────
      if (!existing || existing.status === "complete") {
        if (isTrigger(ctx.message)) {
          const parsedAgents = parseAgents(ctx.message);
          const rawAgents =
            parsedAgents.length > 0
              ? parsedAgents
              : defaultAgents.length > 0
                ? [...defaultAgents]
                : [ctx.adapter];

          const agents = dedupe(rawAgents);
          const rounds = parseRounds(ctx.message) ?? defaultRounds;
          const topic = parseTopic(ctx.message);

          // Warn on single-agent roundtable
          if (agents.length < 2) {
            writeLogEvent({
              level: "warn",
              component: COMPONENT,
              action: "single-agent",
              message: `Roundtable started with only ${agents.length} agent(s) — multi-agent discussion requires 2+`,
              data: { agents, sessionId: ctx.sessionId },
            });
          }

          const state: RoundtableState = {
            id: generateId(),
            topic,
            agents,
            modes: assignModes(agents, defaultMode),
            rounds,
            currentRound: 1,
            currentTurnIndex: 0,
            responses: [],
            status: "active",
            startedAt: new Date().toISOString(),
          };

          setState(ctx.sessionId, state);

          writeLogEvent({
            level: "info",
            component: COMPONENT,
            action: "start",
            message: `Roundtable '${state.id}' started — topic: "${topic}", agents: [${agents.join(", ")}], rounds: ${rounds}`,
            data: {
              id: state.id,
              topic,
              agents,
              rounds,
              modes: state.modes,
              sessionId: ctx.sessionId,
            },
          });

          return {
            pass: true,
            metadata: {
              roundtable: true,
              roundtableId: state.id,
              status: "active",
              topic,
              agents,
              currentAgent: agents[0],
              currentRound: 1,
              totalRounds: rounds,
              mode: state.modes[agents[0]],
            },
          };
        }

        // No active roundtable and not a trigger — pass through
        return { pass: true };
      }

      // ── Active roundtable — turn management ───────────────────
      if (existing.status === "active") {
        const expectedAgent = existing.agents[existing.currentTurnIndex];
        const actualAgent = ctx.adapter;
        const isExpectedTurn = actualAgent === expectedAgent;

        // Out-of-turn handling
        if (!isExpectedTurn) {
          const shouldBlock = enforcement === "enforce";

          writeLogEvent({
            level: shouldBlock ? "warn" : "info",
            component: COMPONENT,
            action: "turn-check",
            message: `Out-of-turn message from '${actualAgent}' — expected '${expectedAgent}' (enforcement=${enforcement})`,
            data: {
              roundtableId: existing.id,
              expected: expectedAgent,
              actual: actualAgent,
              enforcement,
              blocked: shouldBlock,
              round: existing.currentRound,
              sessionId: ctx.sessionId,
            },
          });

          if (shouldBlock) {
            return {
              pass: false,
              block: true,
              reason: `Blocked: roundtable expects '${expectedAgent}' to speak next (round ${existing.currentRound})`,
            };
          }

          // log/advise — flag but allow
          return {
            pass: true,
            flag:
              enforcement === "advise"
                ? `Roundtable turn order: '${expectedAgent}' should speak next (round ${existing.currentRound})`
                : undefined,
            metadata: {
              roundtable: true,
              roundtableId: existing.id,
              outOfTurn: true,
              expectedAgent,
              actualAgent,
              currentRound: existing.currentRound,
            },
          };
        }

        // Correct turn — allow and report metadata
        writeLogEvent({
          level: "info",
          component: COMPONENT,
          action: "turn-check",
          message: `Turn confirmed for '${actualAgent}' — round ${existing.currentRound}, index ${existing.currentTurnIndex}`,
          data: {
            roundtableId: existing.id,
            agent: actualAgent,
            round: existing.currentRound,
            turnIndex: existing.currentTurnIndex,
            sessionId: ctx.sessionId,
          },
        });

        return {
          pass: true,
          metadata: {
            roundtable: true,
            roundtableId: existing.id,
            status: "active",
            currentAgent: expectedAgent,
            currentRound: existing.currentRound,
            totalRounds: existing.rounds,
            mode: existing.modes[expectedAgent],
          },
        };
      }

      // ── Synthesizing — allow the synthesis message through, then complete ──
      if (existing.status === "synthesizing") {
        writeLogEvent({
          level: "info",
          component: COMPONENT,
          action: "synthesize",
          message: `Roundtable '${existing.id}' is synthesizing — allowing message and completing`,
          data: {
            roundtableId: existing.id,
            sessionId: ctx.sessionId,
          },
        });

        // Transition to complete — the synthesis message has arrived
        existing.status = "complete";
        setState(ctx.sessionId, existing);

        return {
          pass: true,
          metadata: {
            roundtable: true,
            roundtableId: existing.id,
            status: "complete",
            responses: existing.responses,
            topic: existing.topic,
          },
        };
      }

      // Fallback — complete or unknown status
      return { pass: true };
    },

    // ─── inject ──────────────────────────────────────────────────

    inject(ctx: HookContext): HookMetadata | undefined {
      const state = getState(ctx.sessionId);
      if (!state || state.status === "complete") return undefined;

      const currentAgent = state.agents[state.currentTurnIndex];

      return {
        roundtable: true,
        roundtableId: state.id,
        status: state.status,
        topic: state.topic,
        currentAgent,
        currentRound: state.currentRound,
        totalRounds: state.rounds,
        mode: state.modes[currentAgent],
        responsesSoFar: state.responses.length,
      };
    },

    // ─── postProcess — record responses and advance turns ────────

    async postProcess(ctx: HookContext, response: AgentResponse): Promise<void> {
      const state = getState(ctx.sessionId);
      if (!state || state.status !== "active") return;

      const expectedAgent = state.agents[state.currentTurnIndex];
      const actualAgent = ctx.adapter;
      const content = response.content ?? "";

      // If this response is from an out-of-turn agent (allowed in log/advise),
      // record it under the actual agent but do NOT advance the turn index.
      if (actualAgent !== expectedAgent) {
        state.responses.push({
          agent: actualAgent,
          round: state.currentRound,
          content,
        });

        writeLogEvent({
          level: "warn",
          component: COMPONENT,
          action: "record-response-out-of-turn",
          message: `Recorded out-of-turn response from '${actualAgent}' (expected '${expectedAgent}') — turn NOT advanced`,
          data: {
            roundtableId: state.id,
            actual: actualAgent,
            expected: expectedAgent,
            round: state.currentRound,
            sessionId: ctx.sessionId,
          },
        });

        setState(ctx.sessionId, state);
        return;
      }

      // Record response from the expected agent
      state.responses.push({
        agent: actualAgent,
        round: state.currentRound,
        content,
      });

      writeLogEvent({
        level: "info",
        component: COMPONENT,
        action: "record-response",
        message: `Recorded response from '${actualAgent}' — round ${state.currentRound}, ${content.length} chars`,
        data: {
          roundtableId: state.id,
          agent: actualAgent,
          round: state.currentRound,
          contentLength: content.length,
          totalResponses: state.responses.length,
          sessionId: ctx.sessionId,
        },
      });

      // Advance turn index
      const nextTurnIndex = state.currentTurnIndex + 1;

      if (nextTurnIndex < state.agents.length) {
        // More agents to go in this round
        state.currentTurnIndex = nextTurnIndex;

        writeLogEvent({
          level: "info",
          component: COMPONENT,
          action: "advance-turn",
          message: `Advanced to agent '${state.agents[nextTurnIndex]}' (index ${nextTurnIndex}) in round ${state.currentRound}`,
          data: {
            roundtableId: state.id,
            nextAgent: state.agents[nextTurnIndex],
            nextTurnIndex,
            round: state.currentRound,
            sessionId: ctx.sessionId,
          },
        });
      } else {
        // All agents responded — advance to next round or finish
        const nextRound = state.currentRound + 1;

        if (nextRound <= state.rounds) {
          state.currentRound = nextRound;
          state.currentTurnIndex = 0;

          writeLogEvent({
            level: "info",
            component: COMPONENT,
            action: "advance-round",
            message: `Advanced to round ${nextRound}/${state.rounds} — starting with '${state.agents[0]}'`,
            data: {
              roundtableId: state.id,
              newRound: nextRound,
              totalRounds: state.rounds,
              firstAgent: state.agents[0],
              sessionId: ctx.sessionId,
            },
          });
        } else {
          // All rounds complete — synthesize
          state.status = "synthesizing";

          writeLogEvent({
            level: "info",
            component: COMPONENT,
            action: "synthesize-start",
            message: `All ${state.rounds} rounds complete for roundtable '${state.id}' — status → synthesizing`,
            data: {
              roundtableId: state.id,
              totalResponses: state.responses.length,
              rounds: state.rounds,
              agents: state.agents,
              sessionId: ctx.sessionId,
            },
          });
        }
      }

      setState(ctx.sessionId, state);
    },
  };
}
