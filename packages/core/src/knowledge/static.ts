/**
 * Static ARC knowledge: purpose, architecture, concept glossary, and command
 * catalog. This payload is composed into the assistant system prompt by
 * buildSystemPrompt() at runtime.
 */

export type CommandCategory =
  | "profile"
  | "launch"
  | "diagnostic"
  | "orchestration"
  | "data"
  | "utility";

export interface CommandDoc {
  name: string;
  description: string;
  examples?: string[];
  category: CommandCategory;
}

export interface ArcKnowledge {
  purpose: string;
  architecture: string;
  concepts: Record<string, string>;
  commands: CommandDoc[];
  docLinks: Record<string, string>;
}

/**
 * Curated catalog of ARC CLI commands. Not auto-generated; kept in sync with
 * packages/cli/src/cli.ts by hand. Covers the most common commands + key
 * subcommands. Not exhaustive (~45 entries).
 */
export const COMMANDS_CATALOG: CommandDoc[] = [
  // ─── Profile management ─────────────────────────────────────────────
  {
    name: "profile list",
    description: "List all registered profiles with tool, auth type, and active marker.",
    category: "profile",
    examples: ["arc profile list", "arc ls"],
  },
  {
    name: "profile show",
    description: "Show full profile record (env overrides, hooks, shared layer state).",
    category: "profile",
    examples: ["arc profile show", "arc profile show work"],
  },
  {
    name: "profile switch",
    description: "Set the active profile. Subsequent launches use its config dir and env.",
    category: "profile",
    examples: ["arc profile switch work", "arc use work"],
  },
  {
    name: "profile create",
    description: "Create a new profile. Prompts for tool binary, auth type, and description.",
    category: "profile",
    examples: [
      "arc profile create work",
      "arc create work --tool claude --auth-type oauth",
    ],
  },
  {
    name: "profile clone",
    description: "Copy an existing profile's config dir into a new profile with a new name.",
    category: "profile",
    examples: ["arc profile clone work work-staging"],
  },
  {
    name: "profile delete",
    description: "Delete a profile and its isolated config dir. Prompts for confirmation.",
    category: "profile",
    examples: ["arc profile delete old-profile"],
  },
  {
    name: "profile import",
    description: "Interactive import of existing tool installs (~/.claude, ~/.codex, etc.).",
    category: "profile",
    examples: ["arc profile import"],
  },
  {
    name: "profile export",
    description: "Export profile config dir as a tarball for backup or transfer.",
    category: "profile",
    examples: ["arc profile export work ./work.tgz"],
  },
  {
    name: "profile import-file",
    description: "Restore a profile from a tarball produced by profile export.",
    category: "profile",
    examples: ["arc profile import-file ./work.tgz"],
  },
  {
    name: "profile clear-active",
    description: "Unset the active profile without deleting it.",
    category: "profile",
    examples: ["arc profile clear-active"],
  },

  // ─── Launch ─────────────────────────────────────────────────────────
  {
    name: "launch",
    description:
      "Launch the active profile's tool (or a named one). Default mode wraps the tool with ARC hooks.",
    category: "launch",
    examples: ["arc launch", "arc launch work"],
  },
  {
    name: "launch --bare",
    description:
      "Launch the tool binary with the profile's env + configDir but no ARC wrapping or hooks.",
    category: "launch",
    examples: ["arc launch --bare", "arc launch work --bare"],
  },
  {
    name: "launch --native",
    description:
      "Use the tool's native plugin/adapter integration when available (e.g. Claude Code plugin).",
    category: "launch",
    examples: ["arc launch --native"],
  },
  {
    name: "launch --worker",
    description:
      "Launch in worker permission mode (restricted allowlist, non-interactive).",
    category: "launch",
    examples: ["arc launch --worker"],
  },
  {
    name: "run",
    description: "Run a one-shot prompt against the active profile's tool and print the result.",
    category: "launch",
    examples: ['arc run "summarize this repo"'],
  },
  {
    name: "exec",
    description: "Run a shell command with the profile's env vars applied (configDir, tool env).",
    category: "launch",
    examples: ["arc exec -- claude --version"],
  },
  {
    name: "shell",
    description: "Open a subshell with the profile's env vars applied.",
    category: "launch",
    examples: ["arc shell"],
  },

  // ─── Diagnostic ─────────────────────────────────────────────────────
  {
    name: "doctor",
    description:
      "Run diagnostic checks (binary on PATH, auth present, config dir writable). Prints repair hints.",
    category: "diagnostic",
    examples: ["arc doctor"],
  },
  {
    name: "health",
    description: "Structured JSON health report — used by the TUI and dashboard.",
    category: "diagnostic",
    examples: ["arc health"],
  },
  {
    name: "logs",
    description: "Tail or show the ARC activity log (~/.arc/activity.log).",
    category: "diagnostic",
    examples: ["arc logs", "arc logs --tail 50"],
  },
  {
    name: "which",
    description: "Print the active profile's resolved config dir and tool binary path.",
    category: "diagnostic",
    examples: ["arc which"],
  },

  // ─── Orchestration ──────────────────────────────────────────────────
  {
    name: "tasks list",
    description: "List persisted orchestration tasks (delegated, scheduled, completed).",
    category: "orchestration",
    examples: ["arc tasks list"],
  },
  {
    name: "tasks create",
    description: "Create a new task with description, priority, and optional assignee.",
    category: "orchestration",
    examples: ['arc tasks create "refactor auth flow"'],
  },
  {
    name: "tasks stop",
    description: "Cancel a running task.",
    category: "orchestration",
    examples: ["arc tasks stop t-42"],
  },
  {
    name: "sessions list",
    description: "List session threads (running, paused, completed).",
    category: "orchestration",
    examples: ["arc sessions list"],
  },
  {
    name: "sessions resume",
    description: "Resume the most recent session or a specific session id.",
    category: "orchestration",
    examples: ["arc sessions resume", "arc sessions resume s-12"],
  },
  {
    name: "factory status",
    description: "Show Dark Factory wave status (parallel agent spec execution).",
    category: "orchestration",
    examples: ["arc factory status"],
  },
  {
    name: "remote list",
    description: "List registered remote agents (MCP/HTTP bridges).",
    category: "orchestration",
    examples: ["arc remote list"],
  },

  // ─── Data ───────────────────────────────────────────────────────────
  {
    name: "backup create",
    description: "Create a compressed snapshot of ~/.arc (config + profile dirs).",
    category: "data",
    examples: ["arc backup create"],
  },
  {
    name: "backup list",
    description: "List available backup snapshots with timestamps and sizes.",
    category: "data",
    examples: ["arc backup list"],
  },
  {
    name: "backup restore",
    description: "Restore a backup snapshot. Prompts before overwriting current state.",
    category: "data",
    examples: ["arc backup restore 2026-04-17T12-00"],
  },
  {
    name: "shared status",
    description: "Show which profiles are subscribed to the shared layer and what it contains.",
    category: "data",
    examples: ["arc shared status"],
  },
  {
    name: "shared pull",
    description:
      "Pull a profile's MCPs/commands/CLAUDE.md/memory/projects into ~/.arc/shared/.",
    category: "data",
    examples: ["arc shared pull work"],
  },
  {
    name: "shared push",
    description: "Push (enable) the shared layer onto a profile so it sees shared resources.",
    category: "data",
    examples: ["arc shared enable work"],
  },
  {
    name: "memory list",
    description: "List persistent memory entries (scoped, typed, scored).",
    category: "data",
    examples: ["arc memory list"],
  },
  {
    name: "memory search",
    description: "Full-text search memory entries.",
    category: "data",
    examples: ['arc memory search "oauth refresh"'],
  },
  {
    name: "skills list",
    description: "List loaded skills and their contract metadata.",
    category: "data",
    examples: ["arc skills list"],
  },

  // ─── Utility ────────────────────────────────────────────────────────
  {
    name: "mcp connect",
    description: "Add an MCP server to the active profile's config.",
    category: "utility",
    examples: ["arc mcp connect github https://mcp.github.dev"],
  },
  {
    name: "mcp list",
    description: "List MCP servers configured for the active profile.",
    category: "utility",
    examples: ["arc mcp list"],
  },
  {
    name: "swap capture",
    description:
      "[experimental] Capture the current tool's auth credentials into a named snapshot.",
    category: "utility",
    examples: ["arc swap capture personal"],
  },
  {
    name: "swap to",
    description:
      "[experimental] Swap the live tool credentials to a named snapshot without touching MCPs/settings.",
    category: "utility",
    examples: ["arc swap to work"],
  },
  {
    name: "instructions show",
    description: "Show the agent instructions injected as ARC_AGENT_INSTRUCTIONS at launch.",
    category: "utility",
    examples: ["arc instructions show"],
  },
  {
    name: "instructions set",
    description: "Set inline agent instructions for the active profile.",
    category: "utility",
    examples: ['arc instructions set "Always run typecheck before commit"'],
  },
  {
    name: "instructions edit",
    description: "Open the instructions file in $EDITOR.",
    category: "utility",
    examples: ["arc instructions edit"],
  },
  {
    name: "instructions clear",
    description: "Remove agent instructions from the active profile.",
    category: "utility",
    examples: ["arc instructions clear"],
  },
  {
    name: "provider set",
    description:
      "Configure an OpenAI-compatible provider (baseUrl, model, apiKeyEnvVar) on the active profile.",
    category: "utility",
    examples: ["arc provider set --preset openrouter"],
  },
  {
    name: "provider show",
    description: "Show the active profile's configured provider.",
    category: "utility",
    examples: ["arc provider show"],
  },
  {
    name: "provider clear",
    description: "Remove the provider config from the active profile.",
    category: "utility",
    examples: ["arc provider clear"],
  },
  {
    name: "provider presets",
    description:
      "List built-in provider presets (OpenRouter, Ollama, LM Studio, Together, Groq, MiniMax, DeepSeek).",
    category: "utility",
    examples: ["arc provider presets"],
  },
  {
    name: "dashboard",
    description: "Open the ARC web dashboard in the browser.",
    category: "utility",
    examples: ["arc dashboard"],
  },
  {
    name: "shell-init",
    description: "Print shell init snippet (completions, PROMPT_COMMAND integration).",
    category: "utility",
    examples: ["arc shell-init bash"],
  },
  {
    name: "update",
    description: "Self-update ARC via npm install -g.",
    category: "utility",
    examples: ["arc update"],
  },
];

export const ARC_KNOWLEDGE: ArcKnowledge = {
  purpose: [
    "ARC (Agent Runtime Control) is a CLI and TUI for managing multiple agent",
    "runtimes — Claude Code, Gemini CLI, Codex CLI, OpenClaw, and any OpenAI",
    "compatible tool — side by side on a single machine. Each runtime lives",
    "in an isolated profile with its own config directory, credentials, MCP",
    "servers, hooks, and environment variables. Switching profiles is a",
    "single command; launching a profile rewrites the target tool's HOME-",
    "equivalent env vars (CLAUDE_CONFIG_DIR, GEMINI_CLI_HOME, CODEX_HOME,",
    "HERMES_HOME) so the tool reads only that profile's state.",
    "",
    "The problem ARC solves: agent CLIs assume a single global install and",
    "a single credential set. Users who need work/personal separation,",
    "multiple API keys, per-project MCP sets, or reproducible setups across",
    "machines hit painful collisions. ARC removes the collisions by",
    "scoping every piece of state to a profile and providing operations —",
    "clone, import, export, shared layer, credential hot-swap, backup —",
    "that treat profiles as first-class artifacts. On top of that base,",
    "ARC adds an orchestration layer (hook pipeline, roundtable, task",
    "delegation, risk classification) so the same profiles can be used",
    "both for interactive sessions and for supervised multi-agent work.",
  ].join(" "),

  architecture: [
    "Monorepo laid out as pnpm workspaces under packages/: core (profile",
    "model, hooks, memory, sessions, skills, tasks, telemetry, sync,",
    "factory, permissions), cli (Commander.js surface + Ink TUI),",
    "adapter-claude, adapter-openclaw, mcp, and dashboard (web UI).",
    "",
    "Profiles are records in ~/.arc/config.json that point at an isolated",
    "config directory under ~/.arc/profiles/<name>/. At launch time the",
    "runtime resolves the profile, rewrites env (HOME-equivalents per",
    "tool, plus envOverrides and ARC_AGENT_INSTRUCTIONS), and invokes the",
    "right adapter.",
    "",
    "Adapters implement a common interface (detect, launch, hook into",
    "tool output) for each backend: Claude Code (SDK + plugin + hooks),",
    "Codex CLI, Gemini CLI, OpenClaw (native plugin), Hermes (MCP bridge),",
    "OpenAI-compatible (custom baseUrl/model), Generic (fallback).",
    "",
    "The hook pipeline is a priority-ordered bus of 8 hooks (source-",
    "classify → risk detect → interagent routing → supervision gate →",
    "agent execution → post-verify → audit → roundtable). Each profile",
    "selects an enforcement mode (off/log/advise/enforce).",
    "",
    "The shared layer lives under ~/.arc/shared/ and syncs MCP servers,",
    "slash commands, CLAUDE.md, memory, and projects across profiles",
    "that opt in. Pull copies from a profile into shared; enable links",
    "shared into a profile via directory links or merged files.",
    "",
    "MCP integration: MCP servers are declared per profile and reachable",
    "from whichever tool is launched. The dashboard is a React app that",
    "reads ~/.arc via a local HTTP bridge and surfaces sessions, traces,",
    "risk, tasks, skills, memory, agents, factory, profiles, diagnostics,",
    "sync, and plugins.",
    "",
    "The roundtable module runs multi-agent discussions for a single",
    "request, collecting agent outputs and synthesizing a verdict through",
    "the hook bus so the orchestration and adapter layers share one path.",
  ].join(" "),

  concepts: {
    profile:
      "A named runtime record (tool, auth type, config dir, env, hooks) stored in ~/.arc/config.json.",
    "active profile":
      "The profile ARC uses by default for launch/run/exec. Set via `arc use` or `arc profile switch`.",
    "config dir":
      "The isolated directory under ~/.arc/profiles/<name>/ that holds tool-native config, credentials, and history.",
    "bare launch":
      "Launch mode that sets the profile env and invokes the tool binary directly — no hooks, no wrapping.",
    "launch mode":
      "One of: default (hook-wrapped), --bare (no wrapping), --native (tool-native plugin integration), --worker (restricted permissions).",
    adapter:
      "Per-tool integration module (claude, codex, gemini, openclaw, hermes, openai-compat, generic) implementing detect + launch + hook.",
    "shared layer":
      "~/.arc/shared/ holding MCP servers, commands, CLAUDE.md, memory, and projects that multiple profiles can opt into.",
    "hook pipeline":
      "Priority-ordered bus of 8 hooks (source-classify, risk, routing, supervision, exec, post-verify, audit, roundtable) run around every agent turn.",
    "enforcement mode":
      "Per-profile hook behavior: off (skip), log (observe), advise (inject suggestions), enforce (block on failures).",
    roundtable:
      "Multi-agent discussion protocol: several agents answer the same prompt, results are synthesized into a single verdict.",
    "permission mode":
      "read-only | supervised | autonomous — governs whether the assistant may call tools and whether destructive ops need confirmation.",
    "risk tier":
      "Output of the risk-detection hook: low | medium | high | critical. Higher tiers raise supervision requirements.",
    "credential hot-swap":
      "[experimental] `arc swap` — capture/restore tool auth credentials without touching MCPs, settings, or history.",
    "agent instructions":
      "Per-profile prompt text resolved at launch and injected as ARC_AGENT_INSTRUCTIONS env var.",
    telemetry:
      "OpenTelemetry spans around sessions, preflight, hooks, agent execution, tool use, postflight, and circuit breakers.",
    factory:
      "Dark Factory Mode — parallel wave execution of agent specs for batch/background work.",
    "profile inheritance":
      "A profile may set `inherits: <parent>` to reuse env, hooks, and config fields unless overridden.",
  },

  commands: COMMANDS_CATALOG,

  docLinks: {
    "getting started": "/docs/getting-started",
    profiles: "/docs/profiles",
    authentication: "/docs/authentication",
    configuration: "/docs/configuration",
    advanced: "/docs/advanced",
    "shell integration": "/docs/shell-integration",
    troubleshooting: "/docs/troubleshooting",
    development: "/docs/development",
    spec: "/docs/spec/SPEC",
  },
};
