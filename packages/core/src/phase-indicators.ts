// ─── Types ──────────────────────────────────────────────────────────

export type AgentPhase =
  | "thinking"
  | "reading"
  | "writing"
  | "executing"
  | "reviewing"
  | "testing"
  | "deploying"
  | "idle";

// ─── Tool → Phase mapping ───────────────────────────────────────────

/**
 * Maps lowercase tool-name prefixes to their corresponding phase.
 * Order matters: first match wins in `detectPhase`.
 */
const TOOL_PHASE_MAP: Array<[string[], AgentPhase]> = [
  // Reading / searching
  [["read", "glob", "grep", "search", "find", "cat", "head", "tail", "ls"], "reading"],

  // Writing / editing
  [["write", "edit", "notebookedit", "create_file", "patch"], "writing"],

  // Testing
  [["test", "jest", "vitest", "pytest", "mocha", "assert"], "testing"],

  // Deploying
  [["deploy", "publish", "release", "push"], "deploying"],

  // Reviewing
  [["review", "diff", "pr", "audit", "lint", "check"], "reviewing"],

  // Executing (broad — shells, scripts, misc commands)
  [["bash", "powershell", "shell", "exec", "run", "npm", "pnpm", "yarn", "node", "python", "cargo", "go", "make", "docker"], "executing"],
];

// ─── Phase detection ────────────────────────────────────────────────

/**
 * Deterministically detect the agent phase based on the tool being invoked.
 *
 * When no tool is active (empty or unknown name), defaults to `"thinking"`.
 * The optional `toolArgs` parameter is reserved for future heuristic
 * refinements (e.g. distinguishing a dry-run deploy from a real one).
 */
export function detectPhase(toolName: string, _toolArgs?: unknown): AgentPhase {
  if (!toolName) return "thinking";

  const lower = toolName.toLowerCase();

  for (const [prefixes, phase] of TOOL_PHASE_MAP) {
    for (const prefix of prefixes) {
      if (lower === prefix || lower.startsWith(prefix)) {
        return phase;
      }
    }
  }

  // Unknown tool: fall back to thinking (the agent is deciding what to do).
  return "thinking";
}

// ─── Human-readable verbs ───────────────────────────────────────────

const PHASE_VERBS: Record<AgentPhase, string> = {
  thinking: "Thinking",
  reading: "Reading",
  writing: "Writing",
  executing: "Executing",
  reviewing: "Reviewing",
  testing: "Testing",
  deploying: "Deploying",
  idle: "Idle",
};

const PHASE_COMPLETION_VERBS: Record<AgentPhase, string> = {
  thinking: "Thought",
  reading: "Read",
  writing: "Wrote",
  executing: "Executed",
  reviewing: "Reviewed",
  testing: "Tested",
  deploying: "Deployed",
  idle: "Idled",
};

/** Return a human-readable present-tense verb for the phase. */
export function getPhaseVerb(phase: AgentPhase): string {
  return PHASE_VERBS[phase];
}

/** Return a human-readable past-tense verb for the phase. */
export function getPhaseCompletionVerb(phase: AgentPhase): string {
  return PHASE_COMPLETION_VERBS[phase];
}
