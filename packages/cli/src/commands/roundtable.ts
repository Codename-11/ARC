/**
 * `arc roundtable` — spawn a multi-agent discussion using the Phase 5
 * orchestrator. Streams per-agent turns + synthesis to stdout with colour-
 * coded role headers.
 *
 * See docs/plans/ai-and-roundtable.md — Phase 6.
 */

import pc from "picocolors";
import {
  RoundtableOrchestrator,
  loadConfig,
  type AgentChunk,
  type Profile,
  type RoundtableAgent,
  type RoundtableEvent,
  type RoundtableResult,
  type RoundtableRole,
} from "@axiom-labs/arc-core";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RoundtableCliOptions {
  agents?: string;
  rounds?: string | number;
  synthesizer?: string;
  roles?: string;
  format?: "plain" | "json";
  pacing?: boolean;
}

// ---------------------------------------------------------------------------
// IO helpers
// ---------------------------------------------------------------------------

function writeText(s: string): void {
  process.stdout.write(s);
}
function writeLine(s: string): void {
  process.stdout.write(s + "\n");
}
function printError(s: string): void {
  process.stderr.write(pc.red("\u2716") + " " + s + "\n");
}

const ROLE_COLORS: Record<RoundtableRole, (s: string) => string> = {
  advocate: pc.green,
  critic: pc.red,
  neutral: pc.cyan,
  synthesizer: pc.magenta,
};

function colorize(role: RoundtableRole, text: string): string {
  const c = ROLE_COLORS[role] ?? pc.white;
  return c(text);
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseRole(val: string, agentIndex: number): RoundtableRole {
  const v = val.trim().toLowerCase();
  if (v === "advocate" || v === "critic" || v === "neutral" || v === "synthesizer") {
    return v;
  }
  throw new Error(
    `Invalid role "${val}" at agent position ${agentIndex + 1}. Expected: advocate | critic | neutral | synthesizer.`,
  );
}

function defaultRole(index: number): RoundtableRole {
  if (index === 0) return "advocate";
  if (index === 1) return "critic";
  return "neutral";
}

function parseList(val: string | undefined): string[] {
  if (!val) return [];
  return val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseRounds(val: string | number | undefined): number {
  if (val === undefined) return 2;
  const n = typeof val === "number" ? val : parseInt(val, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`--rounds must be a positive integer (got "${val}")`);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Orchestrator option injection — allow tests to override via env hook
// ---------------------------------------------------------------------------

export interface RoundtableCliDeps {
  orchestratorFactory?: () => RoundtableOrchestrator;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function handleRoundtable(
  topic: string,
  opts: RoundtableCliOptions,
  deps: RoundtableCliDeps = {},
): Promise<void> {
  if (!topic || !topic.trim()) {
    printError("A topic is required: arc roundtable <topic> --agents a,b,c");
    process.exit(1);
    return;
  }

  const format = opts.format ?? "plain";
  if (format !== "plain" && format !== "json") {
    printError(`--format must be "plain" or "json" (got "${format}")`);
    process.exit(1);
    return;
  }

  // ── Parse agents + roles ──────────────────────────────
  const agentNames = parseList(opts.agents);
  if (agentNames.length < 2) {
    printError(
      `Roundtable requires at least 2 agents. Pass them via --agents a,b,c (got ${agentNames.length}).`,
    );
    process.exit(1);
    return;
  }

  const rolesList = parseList(opts.roles);
  if (rolesList.length > 0 && rolesList.length !== agentNames.length) {
    printError(
      `--roles must have the same number of entries as --agents (got ${rolesList.length} roles for ${agentNames.length} agents).`,
    );
    process.exit(1);
    return;
  }

  let rounds: number;
  try {
    rounds = parseRounds(opts.rounds);
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  }

  // ── Load profiles ─────────────────────────────────────
  const config = loadConfig();
  const agents: RoundtableAgent[] = [];
  for (let i = 0; i < agentNames.length; i++) {
    const name = agentNames[i];
    const profile: Profile | undefined = config.profiles[name];
    if (!profile) {
      printError(
        `Profile "${name}" not found. Run 'arc list' to see available profiles.`,
      );
      process.exit(1);
      return;
    }
    if (!profile.tool) {
      printError(
        `Profile "${name}" has no tool set — cannot participate in roundtable.`,
      );
      process.exit(1);
      return;
    }
    let role: RoundtableRole;
    try {
      role = rolesList.length > 0 ? parseRole(rolesList[i], i) : defaultRole(i);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
      return;
    }
    agents.push({ profile, role, displayName: name });
  }

  // ── Resolve synthesizer ───────────────────────────────
  let synthesizer: RoundtableAgent = agents[0];
  if (opts.synthesizer) {
    const match = agents.find((a) => a.displayName === opts.synthesizer);
    if (!match) {
      printError(
        `--synthesizer "${opts.synthesizer}" must be one of --agents. Got agents: ${agentNames.join(", ")}.`,
      );
      process.exit(1);
      return;
    }
    synthesizer = match;
  }

  // ── Build orchestrator ────────────────────────────────
  const orchestrator = deps.orchestratorFactory
    ? deps.orchestratorFactory()
    : new RoundtableOrchestrator(
        opts.pacing === false
          ? { sleep: async () => {} }
          : {},
      );

  // ── Event handler ─────────────────────────────────────
  const streaming = format === "plain";
  const onEvent = streaming ? makeStreamingHandler() : undefined;

  // ── Run ──────────────────────────────────────────────
  let result: RoundtableResult;
  try {
    result = await orchestrator.run({
      topic,
      agents,
      rounds,
      synthesizer,
      onEvent,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(`Roundtable failed: ${msg}`);
    process.exit(1);
    return;
  }

  // ── Final output ─────────────────────────────────────
  if (format === "json") {
    writeLine(JSON.stringify(result, null, 2));
    return;
  }

  writeLine("");
  writeLine(pc.bold(`Consensus: ${result.consensusScore.toFixed(2)}`));
  writeLine(pc.bold("Summary:"));
  writeLine(result.synthesis);
  if (result.keyPoints.length > 0) {
    writeLine("");
    writeLine(pc.bold("Key points:"));
    for (const kp of result.keyPoints) writeLine(`  - ${kp}`);
  }
  writeLine("");
  writeLine(
    pc.dim(
      `(${result.transcript.length} turns in ${(result.durationMs / 1000).toFixed(1)}s, roundtable id ${result.roundtableId})`,
    ),
  );
}

function makeStreamingHandler(): (evt: RoundtableEvent) => void {
  return (evt: RoundtableEvent): void => {
    switch (evt.type) {
      case "turn-start": {
        const header = `\n[${evt.agent}] [${evt.role}] round ${evt.round} \u2500\u2500\u2500\u2500\u2500`;
        writeLine(colorize(evt.role, header));
        break;
      }
      case "turn-chunk": {
        const chunk: AgentChunk = evt.chunk;
        if (chunk.type === "text") {
          writeText(chunk.content);
        } else if (chunk.type === "error") {
          writeLine("\n" + pc.red(`  [error] ${chunk.message}`));
        }
        break;
      }
      case "turn-complete":
        writeLine("");
        break;
      case "synthesis-start":
        writeLine("\n" + pc.bold(pc.magenta(`\u2500\u2500 Synthesis (${evt.agent}) \u2500\u2500`)));
        break;
      case "synthesis-complete":
        writeLine("");
        writeLine(
          pc.bold(
            `Consensus score: ${evt.consensusScore.toFixed(2)}`,
          ),
        );
        writeLine(pc.bold("Summary:"));
        writeLine(evt.summary);
        break;
      case "phase-change":
        // Quiet — users don't want to see every state transition.
        break;
      case "error":
        writeLine(
          "\n" +
            pc.red(
              `[error] ${evt.agent ? `(${evt.agent}) ` : ""}${evt.message}`,
            ),
        );
        break;
    }
  };
}
