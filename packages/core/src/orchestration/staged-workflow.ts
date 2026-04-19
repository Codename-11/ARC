// Ported from agent-forge/lib/staged-workflow.ts — see docs/plans/ai-and-roundtable.md AD-7
/**
 * Staged workflow — PLAN → EXEC → VERIFY state machine.
 *
 * The manager advances one phase at a time. To leave a phase, every
 * participating agent must have posted a message matching that phase's
 * completion regex set. If the phase timeout expires first, the manager
 * advances anyway and records the timeout in the transcript.
 *
 * The message bus is dependency-injected so the same manager can drive an
 * in-memory test stub or a real bus implementation in production.
 */

// ─── Phase types ─────────────────────────────────────────────────────

export type StagedPhase = "plan" | "exec" | "verify";

export type StagedWorkflowTerminal = "complete" | "aborted";

// ─── Defaults ────────────────────────────────────────────────────────

const DEFAULT_PLAN_TIMEOUT_MS = 120_000;
const DEFAULT_EXEC_TIMEOUT_MS = 300_000;
const DEFAULT_VERIFY_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 50;

/**
 * Default completion regexes — ported from Agent-Forge. Each phase
 * requires at least one match per agent to advance.
 */
export const DEFAULT_COMPLETION_PATTERNS: Record<StagedPhase, RegExp[]> = {
  plan: [
    /\bplan\b/i,
    /\bstrateg/i,
    /\bapproach\b/i,
    /\bready\b/i,
    /\bplan\s+shared\b/i,
  ],
  exec: [
    /\bdone\b/i,
    /\bcomplete(?:d)?\b/i,
    /\bfinished\b/i,
    /\bimplemented\b/i,
    /\bexec_done\b/i,
  ],
  verify: [
    /\bverify(?:_ok)?\b/i,
    /\bverified\b/i,
    /\bapproved\b/i,
    /\breview\s+complete\b/i,
  ],
};

// ─── Public config ───────────────────────────────────────────────────

export interface StagedWorkflowConfig {
  /** Ordered phases to run. Defaults to the full PLAN → EXEC → VERIFY cycle. */
  phases?: StagedPhase[];
  /** Per-phase timeout. Missing entries fall back to per-phase defaults. */
  phaseTimeoutMs?: Partial<Record<StagedPhase, number>>;
  /** Per-phase completion patterns. Overrides defaults for that phase. */
  completionPatterns?: Partial<Record<StagedPhase, RegExp[]>>;
  /** How often to poll the message bus while waiting for completion. */
  pollIntervalMs?: number;
  /** Called whenever the phase changes. Purely observational. */
  onPhaseChange?: (phase: StagedPhase | StagedWorkflowTerminal) => void;
}

// ─── Messages & bus ──────────────────────────────────────────────────

/** Minimal message shape understood by StagedWorkflowManager. */
export interface StagedMessage {
  id: string;
  from: string;
  content: string;
  phase?: StagedPhase;
  createdAt: number;
}

export interface MessageBusReadResult {
  messages: StagedMessage[];
  cursor: number;
}

/** Cursor-based message bus contract the manager depends on. */
export interface StagedMessageBus {
  getMessages(cursor: number): Promise<MessageBusReadResult>;
  post(msg: StagedMessage): Promise<void>;
}

/** Trivial in-memory bus for tests + default runs. */
export class InMemoryMessageBus implements StagedMessageBus {
  private readonly messages: StagedMessage[] = [];

  async getMessages(cursor: number): Promise<MessageBusReadResult> {
    const messages = this.messages.slice(cursor);
    return { messages, cursor: this.messages.length };
  }

  async post(msg: StagedMessage): Promise<void> {
    this.messages.push(msg);
  }

  /** Test-only snapshot. */
  all(): StagedMessage[] {
    return [...this.messages];
  }
}

// ─── Manager ─────────────────────────────────────────────────────────

export interface StagedWorkflowManagerDeps {
  messageBus: StagedMessageBus;
  allAgents: string[];
  /** Override Date.now() for deterministic tests. */
  now?: () => number;
  /** Override setTimeout-based sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface StagedWorkflowResult {
  phase: StagedWorkflowTerminal;
  transcript: StagedMessage[];
  durationMs: number;
  phasesCompleted: StagedPhase[];
  phasesTimedOut: StagedPhase[];
}

export class StagedWorkflowManager {
  private readonly phases: StagedPhase[];
  private readonly phaseTimeoutMs: Record<StagedPhase, number>;
  private readonly completionPatterns: Record<StagedPhase, RegExp[]>;
  private readonly pollIntervalMs: number;
  private readonly onPhaseChange?: (
    phase: StagedPhase | StagedWorkflowTerminal,
  ) => void;
  private readonly bus: StagedMessageBus;
  private readonly allAgents: string[];
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private cursor = 0;
  private transcript: StagedMessage[] = [];
  private currentPhase: StagedPhase | StagedWorkflowTerminal | null = null;

  constructor(config: StagedWorkflowConfig, deps: StagedWorkflowManagerDeps) {
    this.phases =
      config.phases && config.phases.length > 0
        ? [...config.phases]
        : (["plan", "exec", "verify"] as StagedPhase[]);

    const timeoutDefaults: Record<StagedPhase, number> = {
      plan: DEFAULT_PLAN_TIMEOUT_MS,
      exec: DEFAULT_EXEC_TIMEOUT_MS,
      verify: DEFAULT_VERIFY_TIMEOUT_MS,
    };
    this.phaseTimeoutMs = {
      plan: config.phaseTimeoutMs?.plan ?? timeoutDefaults.plan,
      exec: config.phaseTimeoutMs?.exec ?? timeoutDefaults.exec,
      verify: config.phaseTimeoutMs?.verify ?? timeoutDefaults.verify,
    };

    this.completionPatterns = {
      plan:
        config.completionPatterns?.plan ?? DEFAULT_COMPLETION_PATTERNS.plan,
      exec:
        config.completionPatterns?.exec ?? DEFAULT_COMPLETION_PATTERNS.exec,
      verify:
        config.completionPatterns?.verify ?? DEFAULT_COMPLETION_PATTERNS.verify,
    };

    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.onPhaseChange = config.onPhaseChange;
    this.bus = deps.messageBus;
    this.allAgents = [...deps.allAgents];
    this.now = deps.now ?? Date.now;
    this.sleep =
      deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Current phase (or `null` before `run()` starts). */
  getCurrentPhase(): StagedPhase | StagedWorkflowTerminal | null {
    return this.currentPhase;
  }

  async run(): Promise<StagedWorkflowResult> {
    const start = this.now();
    const phasesCompleted: StagedPhase[] = [];
    const phasesTimedOut: StagedPhase[] = [];

    for (const phase of this.phases) {
      this.setPhase(phase);
      this.resetCursor();

      const phaseStart = this.now();
      const timeoutMs = this.phaseTimeoutMs[phase];
      const patterns = this.completionPatterns[phase];

      let advanced = false;
      while (this.now() - phaseStart < timeoutMs) {
        const read = await this.bus.getMessages(this.cursor);
        if (read.messages.length > 0) {
          this.transcript.push(...read.messages);
          this.cursor = read.cursor;
        }
        if (this.allAgentsMatched(patterns)) {
          advanced = true;
          break;
        }
        await this.sleep(this.pollIntervalMs);
      }

      if (advanced) {
        phasesCompleted.push(phase);
      } else {
        phasesTimedOut.push(phase);
      }
    }

    this.setPhase("complete");
    return {
      phase: "complete",
      transcript: [...this.transcript],
      durationMs: this.now() - start,
      phasesCompleted,
      phasesTimedOut,
    };
  }

  /** Abort the workflow (future: signal-based cancellation). */
  abort(): void {
    this.setPhase("aborted");
  }

  // ── Internal ─────────────────────────────────────────────────────

  private resetCursor(): void {
    // Keep the transcript, but future completion checks only look at the
    // messages accumulated *within* the current phase. Callers build their
    // own match set against `this.transcript` filtered by phase.
    this.cursor = 0;
    this.transcript = [];
  }

  private setPhase(next: StagedPhase | StagedWorkflowTerminal): void {
    if (this.currentPhase === next) return;
    this.currentPhase = next;
    try {
      this.onPhaseChange?.(next);
    } catch {
      // Observer errors must never derail the workflow.
    }
  }

  private allAgentsMatched(patterns: RegExp[]): boolean {
    if (this.allAgents.length === 0) return false;
    return this.allAgents.every((agent) =>
      this.transcript.some(
        (msg) =>
          msg.from === agent &&
          patterns.some((re) => re.test(msg.content)),
      ),
    );
  }
}
