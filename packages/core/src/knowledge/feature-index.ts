/**
 * Curated index of ARC features with status and short summaries. Fed into
 * the system prompt so the assistant can talk accurately about what ARC
 * can and cannot do. Keep roughly in sync with FEATURES.md — this file is
 * authoritative for what the AI layer sees.
 */

export type FeatureStatus = "shipped" | "roadmap" | "deferred";

export interface FeatureEntry {
  id: string;
  name: string;
  status: FeatureStatus;
  summary: string;
  since?: string;
  docLink?: string;
}

export const FEATURES_INDEX: FeatureEntry[] = [
  {
    id: "profile-management",
    name: "Profile management",
    status: "shipped",
    summary:
      "Create, clone, import, export, switch, and delete isolated profiles with per-profile config dirs, env, and auth.",
    since: "0.1.0",
    docLink: "/docs/profiles",
  },
  {
    id: "profile-inheritance",
    name: "Profile inheritance",
    status: "shipped",
    summary:
      "A profile may inherit env, hooks, and fields from a parent profile via the `inherits` key.",
    since: "1.2.0",
    docLink: "/docs/profiles",
  },
  {
    id: "bare-launch",
    name: "Bare launch",
    status: "shipped",
    summary:
      "Launch the tool binary directly with profile env — no hook wrapping, no adapter overhead.",
    since: "0.3.0",
    docLink: "/docs/advanced",
  },
  {
    id: "native-launch",
    name: "Native adapter launch",
    status: "shipped",
    summary:
      "Launch through a tool's native plugin/adapter when available (Claude Code plugin, OpenClaw plugin).",
    since: "1.0.0",
  },
  {
    id: "worker-mode",
    name: "Worker permission mode",
    status: "shipped",
    summary:
      "Restricted permission policy for non-interactive worker launches (explicit allowlist, no approvals).",
    since: "1.4.0",
  },
  {
    id: "doctor",
    name: "Doctor diagnostics",
    status: "shipped",
    summary:
      "Environment checks (PATH, auth, writable config dir) with inline repair hints.",
    since: "0.2.0",
    docLink: "/docs/troubleshooting",
  },
  {
    id: "shared-layer",
    name: "Shared layer",
    status: "shipped",
    summary:
      "~/.arc/shared/ syncs MCP servers, commands, CLAUDE.md, memory, and projects across opted-in profiles.",
    since: "1.1.0",
    docLink: "/docs/advanced",
  },
  {
    id: "credential-hotswap",
    name: "Credential hot-swap",
    status: "shipped",
    summary:
      "[experimental] Capture and swap tool auth credentials in the canonical tool dir without touching MCPs, settings, or history.",
    since: "1.3.0",
  },
  {
    id: "agent-instructions",
    name: "Agent instructions",
    status: "shipped",
    summary:
      "Per-profile prompt text resolved at launch and injected as ARC_AGENT_INSTRUCTIONS env var.",
    since: "1.6.0",
  },
  {
    id: "openai-compat-providers",
    name: "OpenAI-compatible providers",
    status: "shipped",
    summary:
      "Custom providers (baseUrl + model + apiKeyEnvVar) with presets for OpenRouter, Ollama, LM Studio, Together, Groq, MiniMax, DeepSeek.",
    since: "1.6.0",
  },
  {
    id: "hook-pipeline",
    name: "Hook pipeline",
    status: "shipped",
    summary:
      "Priority-ordered bus of 8 hooks around every agent turn; per-profile enforcement modes (off/log/advise/enforce).",
    since: "1.4.0",
  },
  {
    id: "risk-classification",
    name: "Risk classification",
    status: "shipped",
    summary:
      "Hook that classifies agent output into low/medium/high/critical tiers to gate supervision.",
    since: "1.4.0",
  },
  {
    id: "source-classification",
    name: "Source classification",
    status: "shipped",
    summary: "Hook that tags message sources (user, agent, system, tool) for downstream routing.",
    since: "1.4.0",
  },
  {
    id: "interagent-routing",
    name: "Interagent routing",
    status: "shipped",
    summary: "Hook that routes messages between agents in multi-agent sessions.",
    since: "1.5.0",
  },
  {
    id: "supervision-gate",
    name: "Supervision gate",
    status: "shipped",
    summary:
      "Hook that pauses high-risk actions for human approval or LLM review depending on permission mode.",
    since: "1.5.0",
  },
  {
    id: "post-verify",
    name: "Post-verify hook",
    status: "shipped",
    summary: "Runs after agent output to verify claims and detect hallucinated state.",
    since: "1.5.0",
  },
  {
    id: "roundtable",
    name: "Roundtable",
    status: "shipped",
    summary:
      "Multi-agent discussion protocol — several agents answer the same prompt, synthesized into a single verdict via the hook bus.",
    since: "1.5.0",
  },
  {
    id: "task-delegation",
    name: "Task delegation",
    status: "shipped",
    summary: "Persisted tasks with priority, status, assignee, and interagent message bus.",
    since: "1.5.0",
  },
  {
    id: "sessions",
    name: "Session continuity",
    status: "shipped",
    summary:
      "Session threads persisted across launches; resume by id or most-recent detection.",
    since: "1.5.0",
  },
  {
    id: "memory",
    name: "Memory system",
    status: "shipped",
    summary:
      "Scoped, typed, decay-scored memory with session and persistent stores and full-text search.",
    since: "1.4.0",
  },
  {
    id: "skills",
    name: "Skill registry",
    status: "shipped",
    summary:
      "Load skills from directories, convert MCP tools into skills, detect repeated patterns, auto-generate skills.",
    since: "1.5.0",
  },
  {
    id: "telemetry",
    name: "Telemetry (OpenTelemetry)",
    status: "shipped",
    summary:
      "OTel spans around sessions, preflight, hooks, agent execution, tool use, postflight, circuit breakers; exporters for console, JSON file, OTLP.",
    since: "1.4.0",
  },
  {
    id: "sync",
    name: "Cloud sync",
    status: "shipped",
    summary: "Filesystem-based sync provider + manager with delta/change tracking.",
    since: "1.4.0",
  },
  {
    id: "plugins",
    name: "Plugin registry",
    status: "shipped",
    summary: "Install, enable, disable, and list plugins with capability manifests.",
    since: "1.5.0",
  },
  {
    id: "remote-agents",
    name: "Remote agents",
    status: "shipped",
    summary: "Register remote agents over HTTP/MCP transports with health checks.",
    since: "1.5.0",
  },
  {
    id: "factory-mode",
    name: "Dark Factory Mode",
    status: "shipped",
    summary: "Parallel wave execution of agent specs for batch/background work.",
    since: "1.5.0",
  },
  {
    id: "dashboard",
    name: "Web dashboard",
    status: "shipped",
    summary:
      "React web UI with 13 views (overview, sessions, traces, risk, tasks, skills, memory, agents, factory, profiles, diagnostics, sync, plugins).",
    since: "1.5.0",
  },
  {
    id: "mcp-integration",
    name: "MCP integration",
    status: "shipped",
    summary: "Per-profile MCP server declarations reachable from the launched tool.",
    since: "1.2.0",
  },
  {
    id: "backup-restore",
    name: "Backup and restore",
    status: "shipped",
    summary: "Snapshot ~/.arc, list snapshots, and restore with confirmation.",
    since: "1.3.0",
  },
  {
    id: "onboarding",
    name: "First-run onboarding",
    status: "shipped",
    summary:
      "Fullscreen TUI wizard for multi-select tool import, rename, and batch profile creation.",
    since: "1.2.0",
    docLink: "/docs/getting-started",
  },
  {
    id: "workspace-shell",
    name: "Workspace shell",
    status: "shipped",
    summary:
      "TUI shell with tokenized input (syntax highlighting + auto-complete) for mixing shell commands and /arc actions.",
    since: "1.6.0",
  },
  {
    id: "ai-assistant",
    name: "In-app AI assistant",
    status: "roadmap",
    summary:
      "Embedded assistant with ARC domain knowledge and tool access for profile/task/session operations (AD-6).",
  },
  {
    id: "knowledge-endowment",
    name: "Knowledge endowment layer",
    status: "shipped",
    summary:
      "System-prompt composition layer (static knowledge + live state) powering the in-app assistant (AD-6 Phase 3).",
    since: "1.7.0",
  },
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Look up a feature by id or name with simple fuzzy matching:
 * exact id → exact name → normalized contains.
 */
export function getFeature(idOrName: string): FeatureEntry | undefined {
  if (!idOrName) return undefined;
  const q = idOrName.trim();
  const qn = normalize(q);

  // exact id
  const byId = FEATURES_INDEX.find((f) => f.id === q);
  if (byId) return byId;

  // exact name (case-insensitive)
  const byName = FEATURES_INDEX.find((f) => f.name.toLowerCase() === q.toLowerCase());
  if (byName) return byName;

  // normalized id contains
  const byIdFuzzy = FEATURES_INDEX.find((f) => normalize(f.id).includes(qn));
  if (byIdFuzzy) return byIdFuzzy;

  // normalized name contains
  const byNameFuzzy = FEATURES_INDEX.find((f) => normalize(f.name).includes(qn));
  if (byNameFuzzy) return byNameFuzzy;

  return undefined;
}

/** Filter features by status. */
export function getFeaturesByStatus(status: FeatureStatus): FeatureEntry[] {
  return FEATURES_INDEX.filter((f) => f.status === status);
}
