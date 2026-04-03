// ---------------------------------------------------------------------------
// Phase 25 — Dark Factory Mode (state-machine scaffold)
// ---------------------------------------------------------------------------

import { writeLogEvent } from "./logging.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FactoryTask {
  description: string;
  files: string[];
  risk: string;
  readOnly?: boolean;
  dependsOn?: string[];
}

export interface FactoryWave {
  name: string;
  tasks: FactoryTask[];
  verifier?: boolean;
}

export interface FactorySpec {
  name: string;
  repo: string;
  profile: string;
  waves: FactoryWave[];
  consensusGate?: {
    enabled: boolean;
    reviewerProfile: string;
    threshold: string; // risk tier
  };
}

export type FactoryStatus =
  | "idle"
  | "planning"
  | "executing"
  | "verifying"
  | "gating"
  | "completed"
  | "failed"
  | "aborted";

export interface FactoryWaveResult {
  wave: string;
  status: "completed" | "failed";
  tasks: number;
}

export interface FactoryState {
  spec: FactorySpec;
  status: FactoryStatus;
  currentWave: number;
  waveResults: FactoryWaveResult[];
  startedAt: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Valid state transitions
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<FactoryStatus, FactoryStatus[]> = {
  idle: ["planning"],
  planning: ["executing", "failed", "aborted"],
  executing: ["verifying", "failed", "aborted"],
  verifying: ["gating", "executing", "completed", "failed", "aborted"],
  gating: ["executing", "completed", "failed", "aborted"],
  completed: [],
  failed: [],
  aborted: [],
};

// ---------------------------------------------------------------------------
// FactoryController
// ---------------------------------------------------------------------------

/**
 * State-machine controller for Dark Factory execution.
 *
 * This is the scaffold layer — it manages state transitions and wave
 * progression.  Actual agent spawning and task execution are wired by
 * higher-level orchestration code.
 */
export class FactoryController {
  private state: FactoryState | null = null;

  // ---- Public API ---------------------------------------------------------

  /** Load a factory spec, initialising the state machine in 'idle'. */
  loadSpec(spec: FactorySpec): void {
    if (spec.waves.length === 0) {
      throw new Error("FactorySpec must contain at least one wave");
    }

    this.state = {
      spec,
      status: "idle",
      currentWave: 0,
      waveResults: [],
      startedAt: "",
    };

    writeLogEvent({
      level: "info",
      component: "factory",
      action: "load-spec",
      message: `Factory spec '${spec.name}' loaded — ${spec.waves.length} wave(s)`,
      data: { name: spec.name, waves: spec.waves.length },
    });
  }

  /** Start factory execution (idle → planning → executing). */
  start(): void {
    this.ensureLoaded();
    this.transition("planning");

    this.state!.startedAt = new Date().toISOString();

    // Immediately advance to executing — the planning phase is a logical
    // marker; concrete planning logic will be injected by the orchestrator.
    this.transition("executing");

    writeLogEvent({
      level: "info",
      component: "factory",
      action: "start",
      message: `Factory '${this.state!.spec.name}' started on wave ${this.state!.currentWave + 1}`,
    });
  }

  /** Abort factory execution from any active state. */
  abort(): void {
    this.ensureLoaded();

    if (this.isTerminal()) {
      throw new Error(`Cannot abort — factory is already '${this.state!.status}'`);
    }

    this.transition("aborted");

    writeLogEvent({
      level: "warn",
      component: "factory",
      action: "abort",
      message: `Factory '${this.state!.spec.name}' aborted`,
    });
  }

  /** Return a readonly snapshot of the current factory state. */
  getState(): Readonly<FactoryState> | null {
    return this.state ? { ...this.state, waveResults: [...this.state.waveResults] } : null;
  }

  /**
   * Advance to the next wave.
   *
   * Records the result for the current wave, then either transitions to the
   * next wave's executing phase or completes the factory run.
   */
  advanceWave(result: { status: "completed" | "failed" }): void {
    this.ensureLoaded();

    const wave = this.getCurrentWave();
    if (!wave) {
      throw new Error("No current wave to advance from");
    }

    // Record result for the current wave.
    this.state!.waveResults.push({
      wave: wave.name,
      status: result.status,
      tasks: wave.tasks.length,
    });

    if (result.status === "failed") {
      this.transition("failed");
      return;
    }

    // Move through verifying → gating (if applicable) → next wave or done.
    if (wave.verifier) {
      this.transition("verifying");
    }

    if (this.state!.spec.consensusGate?.enabled) {
      this.transition("gating");
    }

    // Check if there are more waves.
    const nextIndex = this.state!.currentWave + 1;
    if (nextIndex < this.state!.spec.waves.length) {
      this.state!.currentWave = nextIndex;
      this.transition("executing");

      writeLogEvent({
        level: "info",
        component: "factory",
        action: "advance-wave",
        message: `Advanced to wave ${nextIndex + 1}: '${this.state!.spec.waves[nextIndex].name}'`,
      });
    } else {
      this.state!.completedAt = new Date().toISOString();
      this.transition("completed");

      writeLogEvent({
        level: "info",
        component: "factory",
        action: "complete",
        message: `Factory '${this.state!.spec.name}' completed all ${this.state!.spec.waves.length} wave(s)`,
      });
    }
  }

  /** Return the current wave, or null if no spec is loaded or all waves are done. */
  getCurrentWave(): FactoryWave | null {
    if (!this.state) return null;
    return this.state.spec.waves[this.state.currentWave] ?? null;
  }

  /** Returns true when the factory has reached a terminal state. */
  isComplete(): boolean {
    if (!this.state) return false;
    return this.isTerminal();
  }

  // ---- Internals ----------------------------------------------------------

  private ensureLoaded(): void {
    if (!this.state) {
      throw new Error("No factory spec loaded — call loadSpec() first");
    }
  }

  private isTerminal(): boolean {
    const terminal: FactoryStatus[] = ["completed", "failed", "aborted"];
    return terminal.includes(this.state!.status);
  }

  private transition(to: FactoryStatus): void {
    const from = this.state!.status;
    const allowed = TRANSITIONS[from];

    if (!allowed.includes(to)) {
      throw new Error(`Invalid factory transition: '${from}' → '${to}'`);
    }

    this.state!.status = to;
  }
}
