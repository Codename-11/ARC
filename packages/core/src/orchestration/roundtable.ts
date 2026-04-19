/**
 * Roundtable orchestrator — drives the existing `roundtable` hook from
 * outside. The hook is reactive (it reacts to messages entering the
 * pipeline). This orchestrator is proactive: it iterates turns, calls each
 * agent's AgentClient, feeds the response back through HookBus.runPost() so
 * the hook's state machine advances normally.
 *
 * Design notes:
 *   - Virtual agents (multiple roles sharing one profile) are deferred to
 *     Phase 5.1. The type surface accepts `virtualRole`, but the runner
 *     throws if one is supplied without a dedicated profile.
 *   - `launchMode` is forced to "worker" for every agent profile: the
 *     orchestrator requires captured stdout streams, not TTY handoff.
 *   - Synthesizer JSON parsing is tolerant: if the LLM returns prose, we
 *     return `consensus = 0.5` and `summary = raw text`.
 */

import { writeLogEvent } from "../logging.js";
import type { Profile } from "../types.js";
import { HookBus } from "../hooks/hook-bus.js";
import { HookStateStore } from "../hooks/hook-state.js";
import {
  createRoundtableHook,
  type RoundtableState,
} from "../hooks/roundtable.js";
import type {
  AgentResponse,
  HookContext,
} from "../hooks/types.js";
import type {
  AgentChunk,
  AgentClient,
  AgentSendOptions,
} from "../agent-client/types.js";
import { getAgentClientForProfile } from "../agent-client/dispatch.js";
import {
  computeAdaptiveGraceMs,
  createDeliveryState,
  resolveDeliveryPolicyForTool,
  updateReplyLatencyAverage,
  type AgentDeliveryPolicy,
  type DeliveryState,
} from "./delivery-policy.js";

// ─── Public types ────────────────────────────────────────────────────

export type RoundtableRole =
  | "advocate"
  | "critic"
  | "neutral"
  | "synthesizer";

/**
 * One participant in a roundtable.
 *
 * v1 requires `profile`. `virtualRole` is reserved for Phase 5.1, where
 * multiple logical roles can share a single profile.
 */
export interface RoundtableAgent {
  profile?: Profile;
  virtualRole?: string;
  role: RoundtableRole;
  displayName?: string;
}

export interface RoundtableRunOptions {
  topic: string;
  agents: RoundtableAgent[];
  /** Number of discussion rounds. Defaults to 2. */
  rounds?: number;
  /** Agent that writes the final summary. Defaults to first entry in `agents`. */
  synthesizer?: RoundtableAgent;
  /** Session id to scope hook state. Auto-generated if omitted. */
  sessionId?: string;
  /** Abort signal — propagated into each agent call. */
  signal?: AbortSignal;
  /** Live progress observer. */
  onEvent?: (evt: RoundtableEvent) => void;
}

export interface RoundtableMessage {
  agent: string;
  role: RoundtableRole;
  round: number;
  content: string;
  createdAt: number;
  latencyMs: number;
}

export type RoundtableEvent =
  | {
      type: "turn-start";
      agent: string;
      role: RoundtableRole;
      round: number;
      turnIndex: number;
    }
  | { type: "turn-chunk"; agent: string; chunk: AgentChunk }
  | {
      type: "turn-complete";
      agent: string;
      round: number;
      latencyMs: number;
      content: string;
    }
  | {
      type: "phase-change";
      status: RoundtableState["status"];
    }
  | { type: "synthesis-start"; agent: string }
  | {
      type: "synthesis-complete";
      consensusScore: number;
      summary: string;
    }
  | { type: "error"; message: string; agent?: string };

export interface RoundtableResult {
  transcript: RoundtableMessage[];
  synthesis: string;
  consensusScore: number;
  keyPoints: string[];
  durationMs: number;
  roundtableId: string;
}

// ─── Internals ───────────────────────────────────────────────────────

const COMPONENT = "orchestration:roundtable";

interface PreparedAgent {
  id: string;
  role: RoundtableRole;
  profile: Profile;
  client: AgentClient;
  policy: AgentDeliveryPolicy;
  delivery: DeliveryState;
}

function generateSessionId(): string {
  return `rt-session-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function agentIdentifier(agent: RoundtableAgent, index: number): string {
  if (agent.displayName) return agent.displayName;
  if (agent.profile?.tool) {
    return `${agent.profile.tool}-${index}`;
  }
  return `agent-${index}`;
}

function roleInstruction(role: RoundtableRole, topic: string): string {
  switch (role) {
    case "advocate":
      return `You are the ADVOCATE in a roundtable discussion on: "${topic}". Argue the strongest case for taking action. Be concrete and cite evidence.`;
    case "critic":
      return `You are the CRITIC in a roundtable discussion on: "${topic}". Challenge weak claims. Name the biggest risks the group is glossing over.`;
    case "neutral":
      return `You are a NEUTRAL participant in a roundtable discussion on: "${topic}". Weigh tradeoffs honestly without advocating a side.`;
    case "synthesizer":
      return `You are the SYNTHESIZER in a roundtable discussion on: "${topic}". Your job is to summarize the conversation fairly and score consensus.`;
  }
}

function renderTranscript(transcript: RoundtableMessage[]): string {
  if (transcript.length === 0) return "(no prior messages)";
  return transcript
    .map(
      (m) =>
        `[Round ${m.round}] ${m.agent} (${m.role}):\n${m.content.trim()}`,
    )
    .join("\n\n");
}

function buildTurnPrompt(
  topic: string,
  role: RoundtableRole,
  round: number,
  totalRounds: number,
  transcript: RoundtableMessage[],
): string {
  return [
    roleInstruction(role, topic),
    `This is round ${round} of ${totalRounds}.`,
    "Transcript so far:",
    renderTranscript(transcript),
    "",
    "Write your response now. Be focused — 3-6 sentences.",
  ].join("\n");
}

function buildSynthesisPrompt(
  topic: string,
  transcript: RoundtableMessage[],
): string {
  return [
    roleInstruction("synthesizer", topic),
    "Summarize the discussion and output ONLY a JSON object with this shape:",
    '{ "consensus": <number 0-1>, "summary": <string>, "keyPoints": <string[]> }',
    "",
    "Transcript:",
    renderTranscript(transcript),
    "",
    "Output JSON now. No prose, no markdown fences.",
  ].join("\n");
}

async function collectAgentResponse(
  client: AgentClient,
  prompt: string,
  opts: AgentSendOptions,
  agentId: string,
  onEvent?: (evt: RoundtableEvent) => void,
): Promise<{ content: string; error?: string }> {
  const parts: string[] = [];
  let error: string | undefined;
  try {
    for await (const chunk of client.send(prompt, opts)) {
      if (onEvent) {
        try {
          onEvent({ type: "turn-chunk", agent: agentId, chunk });
        } catch {
          /* observer errors non-fatal */
        }
      }
      if (chunk.type === "text") {
        parts.push(chunk.content);
      } else if (chunk.type === "error") {
        error = chunk.message;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return { content: parts.join(""), error };
}

/**
 * Tolerant synthesizer parser.
 *
 * - Finds the first balanced JSON object in the response (strips markdown
 *   fences, prose prefix/suffix).
 * - On failure, returns a neutral 0.5 consensus and the raw text as summary.
 */
function parseSynthesis(raw: string): {
  consensus: number;
  summary: string;
  keyPoints: string[];
} {
  const fallback = {
    consensus: 0.5,
    summary: raw.trim() || "(no synthesizer output)",
    keyPoints: [] as string[],
  };
  if (!raw.trim()) return fallback;

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return fallback;
  const candidate = raw.slice(start, end + 1);

  try {
    const parsed = JSON.parse(candidate) as {
      consensus?: unknown;
      summary?: unknown;
      keyPoints?: unknown;
    };
    const consensus =
      typeof parsed.consensus === "number" &&
      Number.isFinite(parsed.consensus)
        ? Math.max(0, Math.min(1, parsed.consensus))
        : 0.5;
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary
        : raw.trim();
    const keyPoints = Array.isArray(parsed.keyPoints)
      ? parsed.keyPoints
          .filter((kp): kp is string => typeof kp === "string")
          .map((kp) => kp.trim())
          .filter(Boolean)
      : [];
    return { consensus, summary, keyPoints };
  } catch {
    return fallback;
  }
}

// ─── Orchestrator ────────────────────────────────────────────────────

export interface RoundtableOrchestratorOptions {
  /** Optional custom client factory — lets tests inject mocks. */
  clientFactory?: (profile: Profile) => AgentClient;
  /** Sleep function — swap for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Clock override. */
  now?: () => number;
}

export class RoundtableOrchestrator {
  private readonly clientFactory: (profile: Profile) => AgentClient;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(options: RoundtableOrchestratorOptions = {}) {
    this.clientFactory =
      options.clientFactory ??
      ((profile: Profile) => getAgentClientForProfile(profile));
    this.sleep =
      options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? Date.now;
  }

  async run(opts: RoundtableRunOptions): Promise<RoundtableResult> {
    const start = this.now();
    const rounds = opts.rounds ?? 2;
    const sessionId = opts.sessionId ?? generateSessionId();

    if (opts.agents.length < 2) {
      throw new Error(
        `Roundtable requires at least 2 agents — got ${opts.agents.length}`,
      );
    }

    // Prepare agents (forcing worker launchMode).
    const prepared: PreparedAgent[] = opts.agents.map((agent, i) => {
      if (agent.virtualRole && !agent.profile) {
        throw new Error(
          `Virtual agents not yet supported — assign a profile (agent index ${i}, role "${agent.virtualRole}"). ` +
            `TODO Phase 5.1: allow role-sharing on one profile.`,
        );
      }
      if (!agent.profile) {
        throw new Error(
          `Agent at index ${i} is missing a profile. All v1 roundtable agents need an ARC profile.`,
        );
      }
      const forcedProfile: Profile = { ...agent.profile, launchMode: "worker" };
      const client = this.clientFactory(forcedProfile);
      const policy = resolveDeliveryPolicyForTool(forcedProfile.tool);
      return {
        id: agentIdentifier(agent, i),
        role: agent.role,
        profile: forcedProfile,
        client,
        policy,
        delivery: createDeliveryState(),
      };
    });

    const synthesizerChoice = opts.synthesizer ?? opts.agents[0];
    const synthesizer =
      prepared.find(
        (p, i) => p.id === agentIdentifier(synthesizerChoice, i),
      ) ??
      prepared.find((p) => p.role === "synthesizer") ??
      prepared[0];

    // Build a dedicated HookBus + state store so the orchestrator doesn't
    // clobber any externally-managed pipeline.
    const stateStore = new HookStateStore();
    const hookBus = new HookBus();
    const hook = createRoundtableHook(stateStore, { defaultRounds: rounds });
    hookBus.register(hook, { enabled: true });

    // Fire the trigger to initialize hook state. We use the first agent's
    // id as the "adapter" value for the trigger message.
    // Compose the trigger so agents: stays on its own line (the hook's
    // parser greedy-matches to end-of-line, so we terminate with \n).
    const triggerMessage = [
      `@roundtable rounds: ${rounds}`,
      `agents: ${prepared.map((p) => p.id).join(", ")}`,
      opts.topic,
    ].join("\n");

    const baseCtx = (adapter: string, message: string): HookContext => ({
      message,
      sessionId,
      profile: prepared[0].profile,
      adapter,
      hookMetadata: {},
    });

    await hookBus.runPre(
      baseCtx(prepared[0].id, triggerMessage),
      "log",
      "pre-message",
    );

    const state = stateStore.get<RoundtableState>(
      sessionId,
      "roundtable",
      "roundtableState",
    );
    if (!state) {
      throw new Error(
        "Roundtable hook failed to initialize — no state after trigger",
      );
    }

    const transcript: RoundtableMessage[] = [];
    const totalTurns = rounds * prepared.length;
    let turnsCompleted = 0;

    opts.onEvent?.({ type: "phase-change", status: state.status });

    // Main loop — drive the hook's state machine.
    while (turnsCompleted < totalTurns) {
      if (opts.signal?.aborted) {
        throw new Error("Roundtable aborted");
      }

      const live = stateStore.get<RoundtableState>(
        sessionId,
        "roundtable",
        "roundtableState",
      );
      if (!live || live.status !== "active") break;

      const turnIndex = live.currentTurnIndex;
      const round = live.currentRound;
      const agent = prepared[turnIndex];
      if (!agent) {
        throw new Error(
          `Turn index ${turnIndex} out of range (agents=${prepared.length})`,
        );
      }

      opts.onEvent?.({
        type: "turn-start",
        agent: agent.id,
        role: agent.role,
        round,
        turnIndex,
      });

      const prompt = buildTurnPrompt(
        opts.topic,
        agent.role,
        round,
        rounds,
        transcript,
      );

      const turnStart = this.now();
      const { content, error } = await collectAgentResponse(
        agent.client,
        prompt,
        { signal: opts.signal },
        agent.id,
        opts.onEvent,
      );
      const latencyMs = this.now() - turnStart;

      if (error) {
        opts.onEvent?.({ type: "error", message: error, agent: agent.id });
        writeLogEvent({
          level: "warn",
          component: COMPONENT,
          action: "turn-error",
          message: `Agent '${agent.id}' errored during turn: ${error}`,
          data: { sessionId, round, turnIndex },
        });
      }

      transcript.push({
        agent: agent.id,
        role: agent.role,
        round,
        content,
        createdAt: this.now(),
        latencyMs,
      });

      // Feed response back into the hook so state advances.
      const response: AgentResponse = { content };
      await hookBus.runPost(
        baseCtx(agent.id, prompt),
        response,
        "log",
        "post-message",
      );

      opts.onEvent?.({
        type: "turn-complete",
        agent: agent.id,
        round,
        latencyMs,
        content,
      });

      // Update adaptive pacing and sleep.
      agent.delivery = updateReplyLatencyAverage(agent.delivery, latencyMs);
      const graceMs = computeAdaptiveGraceMs(agent.policy, agent.delivery);

      turnsCompleted++;
      const stateAfter = stateStore.get<RoundtableState>(
        sessionId,
        "roundtable",
        "roundtableState",
      );
      if (stateAfter && stateAfter.status !== "active") {
        opts.onEvent?.({ type: "phase-change", status: stateAfter.status });
      }

      if (turnsCompleted < totalTurns && graceMs > 0) {
        await this.sleep(graceMs);
      }
    }

    // Synthesis.
    opts.onEvent?.({ type: "synthesis-start", agent: synthesizer.id });

    const synthesisPrompt = buildSynthesisPrompt(opts.topic, transcript);
    const { content: rawSynthesis, error: synthesisError } =
      await collectAgentResponse(
        synthesizer.client,
        synthesisPrompt,
        { signal: opts.signal },
        synthesizer.id,
        opts.onEvent,
      );
    if (synthesisError) {
      opts.onEvent?.({
        type: "error",
        message: synthesisError,
        agent: synthesizer.id,
      });
    }

    const parsed = parseSynthesis(rawSynthesis);

    // Feed synthesis back through the hook so status flips to "complete".
    await hookBus.runPost(
      baseCtx(synthesizer.id, synthesisPrompt),
      { content: rawSynthesis },
      "log",
      "post-message",
    );

    opts.onEvent?.({
      type: "synthesis-complete",
      consensusScore: parsed.consensus,
      summary: parsed.summary,
    });
    opts.onEvent?.({ type: "phase-change", status: "complete" });

    return {
      transcript,
      synthesis: parsed.summary,
      consensusScore: parsed.consensus,
      keyPoints: parsed.keyPoints,
      durationMs: this.now() - start,
      roundtableId: state.id,
    };
  }
}
