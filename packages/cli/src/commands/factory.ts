/**
 * arc factory — CLI commands for Dark Factory mode.
 *
 * Subcommands: status, abort
 */
import pc from "picocolors";
import { FactoryController } from "@axiom-labs/arc-core";
import type { FactoryStatus } from "@axiom-labs/arc-core";

// ---------------------------------------------------------------------------
// Shared controller (module-level singleton)
// ---------------------------------------------------------------------------

const controller = new FactoryController();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<string, (s: string) => string> = {
  idle: pc.dim,
  planning: pc.cyan,
  executing: pc.yellow,
  verifying: pc.blue,
  gating: pc.magenta,
  completed: pc.green,
  failed: pc.red,
  aborted: pc.red,
};

function formatStatus(status: string): string {
  const color = STATUS_COLOR[status] ?? pc.white;
  return color(status);
}

function waveProgressBar(current: number, total: number, width = 20): string {
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  const bar = pc.green("█".repeat(filled)) + pc.dim("░".repeat(empty));
  return `[${bar}] ${current}/${total}`;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleFactoryStatus(opts: {
  json?: boolean;
}): Promise<void> {
  const state = controller.getState();

  if (!state) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ status: "idle", message: "No factory run loaded" }, null, 2) + "\n");
      return;
    }
    process.stdout.write(pc.dim("No factory run loaded.") + "\n");
    process.stdout.write(pc.dim("Load a factory spec to begin.") + "\n");
    return;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(state, null, 2) + "\n");
    return;
  }

  process.stdout.write(pc.bold("Factory Status") + "\n\n");
  process.stdout.write(`  Name:     ${pc.bold(state.spec.name)}\n`);
  process.stdout.write(`  Repo:     ${pc.dim(state.spec.repo)}\n`);
  process.stdout.write(`  Profile:  ${state.spec.profile}\n`);
  process.stdout.write(`  Status:   ${formatStatus(state.status)}\n`);

  if (state.startedAt) {
    process.stdout.write(`  Started:  ${pc.dim(state.startedAt)}\n`);
  }
  if (state.completedAt) {
    process.stdout.write(`  Finished: ${pc.dim(state.completedAt)}\n`);
  }

  // Wave progress
  const totalWaves = state.spec.waves.length;
  const completedWaves = state.waveResults.length;

  process.stdout.write(`\n  ${pc.bold("Waves:")}  ${waveProgressBar(completedWaves, totalWaves)}\n\n`);

  for (let i = 0; i < totalWaves; i++) {
    const wave = state.spec.waves[i];
    const result = state.waveResults[i];
    const isCurrent = i === state.currentWave && !result;

    let indicator: string;
    if (result) {
      indicator = result.status === "completed" ? pc.green("✓") : pc.red("✗");
    } else if (isCurrent) {
      indicator = pc.yellow("▸");
    } else {
      indicator = pc.dim("○");
    }

    const taskCount = pc.dim(`(${wave.tasks.length} task${wave.tasks.length === 1 ? "" : "s"})`);
    const verifier = wave.verifier ? pc.dim(" +verify") : "";
    const resultStatus = result ? pc.dim(` — ${result.status}`) : "";

    process.stdout.write(`  ${indicator} ${wave.name} ${taskCount}${verifier}${resultStatus}\n`);
  }

  if (state.spec.consensusGate?.enabled) {
    process.stdout.write(pc.dim(`\n  Consensus gate: enabled (reviewer: ${state.spec.consensusGate.reviewerProfile})`) + "\n");
  }
}

export async function handleFactoryAbort(): Promise<void> {
  try {
    controller.abort();
    process.stdout.write(pc.yellow("Factory run aborted.") + "\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(pc.red(msg) + "\n");
    process.exit(1);
  }
}
