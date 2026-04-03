# ARC — Agent Runtime Control

## Full Specification v2.0

**Status:** Draft — ready for review  
**Repo:** [Codename-11/ARC](https://github.com/Codename-11/ARC)  
**Absorbs:** [Codename-11/axiom-supervisor](https://github.com/Codename-11/axiom-supervisor) (full merger)  
**Updated:** 2026-04-01

---

## 1. What ARC Is

ARC is a **unified agent runtime control plane** — a single CLI/TUI/dashboard that manages the full lifecycle of AI coding agents across runtimes. It replaces both the original ARC profile manager (v0.1) and the Axiom-Supervisor execution layer.

One binary. One config directory (`~/.arc/`). Every agent runtime — Claude Code, Codex CLI, Gemini CLI, OpenClaw, or anything that speaks MCP/HTTP/stdio.

**What it does:**

| Layer | Capability |
|---|---|
| **Identity** | Named profiles, credentials, auth (OAuth/API key/Bedrock/Vertex/Foundry), OS keyring, env isolation |
| **Launch** | Tool detection, shell shims, `arc launch`, per-profile flags, workspace-aware auto-selection |
| **Supervision** | Hook pipeline, risk classification, preflight/postflight, retry loops, scope tracking |
| **Orchestration** | Roundtable multi-agent discussions, interagent routing, source classification, task delegation |
| **Observability** | Debug traces, SQLite persistence, web dashboard, session tracking, alerts, benchmarks, OpenTelemetry |
| **Sync** | Shared config layer (MCP servers, CLAUDE.md), memory-to-Obsidian sync, profile inheritance |
| **Protocols** | MCP host + server, A2A agent cards + task lifecycle, HTTP REST API |
| **Memory** | Hierarchical memory (session/persistent/team), aging/TTL, relevance search, auto-extraction, cross-agent sharing |
| **Skills** | Directory-based skill loading, MCP-to-skill adapters, self-improving skillify (agent writes its own skills) |
| **Tasks** | First-class task tools (create/get/list/update/stop/output), cron scheduling, agent-to-agent messaging |
| **Routing** | Score-based prompt routing — tokenize input, score against tool/command registries, auto-dispatch |

**What it is not:**

- Not a replacement for agent CLIs — it wraps and supervises them
- Not an LLM — it's deterministic-first infrastructure that optionally calls LLMs for enhanced analysis
- Not a framework — it's a runtime control plane that works with any framework

---

## 2. Design Principles

1. **Deterministic over probabilistic** — binary checks first (file changed? build passed?), LLM only sees structured metadata. Same input → same output.
2. **Safe by default** — `log` mode, never `enforce` unless explicitly opted in. No audit loop traps.
3. **Pluggable adapters** — new runtime = new adapter, zero core changes. Common interface, runtime-specific integration depth.
4. **Profile-scoped everything** — switch profile = switch identity + credentials + adapter + hook config + enforcement mode + launch flags + MCP servers.
5. **Graceful degradation** — hook error → skip + log, never crash the pipeline. Watchdog unreachable → warn, don't block.
6. **Protocol-native** — MCP for tool integration, A2A for agent orchestration. Standards over custom wire formats.
7. **Observable** — every supervision decision produces a trace. Every trace is queryable. OpenTelemetry-compatible.
8. **Dark Factory ready** — architecture supports fully autonomous operation: spec in → software out, with ARC as the control plane.

---

## 3. Architecture

### 3.1 High-Level Stack

```
┌─────────────────────────────────────────────────────────────┐
│                     ARC CLI / TUI / Web                      │
│  Profiles · Credentials · Dashboard · Doctor · Onboarding    │
│  TUI: quick ops (Ink)  ·  Web: deep observability (Express)  │
├─────────────────────────────────────────────────────────────┤
│                    Orchestration Layer                        │
│  Hook Pipeline · Risk Classifier · Retry Loop · Roundtable   │
│  Session Tracker · Alert Engine · Scope Tracker · Traces     │
│  Circuit Breaker · Dark Factory Controller                   │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│  Claude  │  Codex   │  Gemini  │ OpenClaw │  Generic        │
│  Adapter │  Adapter  │  Adapter │  Adapter │  Adapter        │
│          │          │          │          │                   │
│  SDK +   │  Process │  Process │  Plugin  │  MCP Server     │
│  Hooks + │  Wrap +  │  Wrap +  │  API +   │  or HTTP        │
│  Plugin  │  MCP +   │  MCP +   │  Hooks   │                 │
│  System  │  JSON    │  stdio   │          │                 │
├──────────┴──────────┴──────────┴──────────┴─────────────────┤
│                     Protocol Layer                           │
│  MCP Host (connect to tool servers)                          │
│  MCP Server (expose ARC supervision as tools)                │
│  A2A Agent Cards (capability discovery + task delegation)    │
├─────────────────────────────────────────────────────────────┤
│                      Storage Layer                           │
│  SQLite (traces, sessions, benchmarks, audit history)        │
│  Profiles & Config (~/.arc/)                                 │
│  OS Keyring (credentials)                                    │
│  OpenTelemetry Export (OTLP)                                 │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

```
Agent launched via `arc launch <profile>`
    ↓
[Profile Resolution]         — credentials, env, adapter, flags
    ↓ (if arc.json found)
[Workspace Override]         — per-repo profile/adapter auto-selection
    ↓ (if inherits set)
[Profile Inheritance]        — base profile merged with overrides
    ↓
[Adapter.launch()]           — spawn agent process with correct env
    ↓
Message/event arrives from agent
    ↓
[Source Classifier]           — human / agent / system / cron (deterministic)
    ↓
[Hook Pipeline]               — sequential by priority, each hook is deterministic
    - check()                 — pass / flag / block (no LLM)
    - inject()                — optional: add structured metadata to agent context
    ↓
[Circuit Breaker]             — 3 consecutive failures → degrade + alert
    ↓
[Agent receives context]      — structured metadata, not freeform LLM text
    ↓
[Agent responds]
    ↓
[Post-Process Hooks]          — memory-sync, post-verify, roundtable advance
    ↓
[Trace Written]               — SQLite + OpenTelemetry span
```

### 3.3 Package Structure (Monorepo)

```
arc/
├── packages/
│   ├── core/                    # Zero adapter dependencies
│   │   ├── hook-bus.ts          # Hook registry + pipeline runner
│   │   ├── rule-engine.ts       # Deterministic rule evaluation
│   │   ├── source-classifier.ts # Message source detection
│   │   ├── risk-classifier.ts   # 5-tier keyword-based risk classification
│   │   ├── intent-expander.ts   # LLM-optional intent expansion
│   │   ├── completion-checklist.ts
│   │   ├── completion-auditor.ts
│   │   ├── assumption-ledger.ts
│   │   ├── scope-tracker.ts
│   │   ├── retry-loop.ts
│   │   ├── session-tracker.ts
│   │   ├── circuit-breaker.ts   # Failure tracking + degradation
│   │   ├── prompt-router.ts     # Score-based intent → tool/command dispatch
│   │   ├── context-manager.ts   # Auto-compaction, token budget, turn tracking
│   │   ├── alert-engine.ts
│   │   ├── event-bus.ts
│   │   ├── trace.ts             # Debug trace builder
│   │   ├── config-loader.ts
│   │   ├── heuristics.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── memory/                  # Hierarchical memory system
│   │   ├── session-memory.ts    # Per-session ephemeral memory
│   │   ├── persistent-memory.ts # Cross-session durable memory
│   │   ├── team-memory.ts       # Shared across agents in multi-agent setups
│   │   ├── aging.ts             # TTL + relevance decay
│   │   ├── relevance.ts         # Context-aware memory search
│   │   ├── extractor.ts         # Auto-extract memories from conversation
│   │   ├── sync.ts              # Obsidian + external sync
│   │   └── index.ts
│   │
│   ├── skills/                  # Skill system (higher-level than tools)
│   │   ├── loader.ts            # Directory-based skill loading
│   │   ├── registry.ts          # Skill registration + discovery
│   │   ├── mcp-adapter.ts       # Wrap any MCP tool as a skill
│   │   ├── skillify.ts          # Meta-skill: agent creates new skills from actions
│   │   ├── stuck-detector.ts    # Self-aware loop/stuck detection + recovery
│   │   └── index.ts
│   │
│   ├── tasks/                   # First-class task management
│   │   ├── task-tools.ts        # TaskCreate/Get/List/Update/Stop/Output as tools
│   │   ├── cron.ts              # CronCreate/Delete/List for scheduled tasks
│   │   ├── messaging.ts         # Agent-to-agent messaging (SendMessageTool)
│   │   └── index.ts
│   │
│   ├── adapters/
│   │   ├── base.ts              # Common adapter interface
│   │   ├── claude-code/         # SDK + Hooks + Plugin integration
│   │   │   ├── sdk-bridge.ts    # SDK Control Protocol (stdin/stdout JSON)
│   │   │   ├── hooks.ts         # All 27 hook event handlers
│   │   │   ├── plugin.ts        # Plugin manifest + registration
│   │   │   └── index.ts
│   │   ├── codex/               # Process wrapper + JSON output + MCP
│   │   │   ├── process.ts       # Spawn + JSON stream parser
│   │   │   ├── instructions.ts  # instructions.md / AGENTS.md management
│   │   │   └── index.ts
│   │   ├── gemini/              # Process wrapper + stdio + MCP
│   │   │   ├── process.ts       # Spawn + stdio capture
│   │   │   ├── instructions.ts  # GEMINI.md management
│   │   │   └── index.ts
│   │   ├── openclaw/            # Native plugin adapter
│   │   │   ├── plugin.ts        # openclaw.plugin.json + hook bus
│   │   │   ├── middleware.ts    # Chat middleware
│   │   │   ├── session-bridge.ts
│   │   │   └── index.ts
│   │   └── generic/             # Fallback: MCP server or HTTP
│   │       ├── mcp-adapter.ts
│   │       ├── http-adapter.ts
│   │       └── index.ts
│   │
│   ├── protocols/
│   │   ├── mcp-host/            # Connect TO external MCP servers
│   │   │   ├── client.ts
│   │   │   ├── transports.ts    # stdio, http, sse, ws
│   │   │   └── index.ts
│   │   ├── mcp-server/          # Expose ARC AS an MCP server
│   │   │   ├── server.ts
│   │   │   └── tools/
│   │   │       ├── expand-intent.ts
│   │   │       ├── classify-risk.ts
│   │   │       ├── derive-completion.ts
│   │   │       ├── audit-completion.ts
│   │   │       └── explain-trace.ts
│   │   └── a2a/                 # Agent-to-Agent protocol
│   │       ├── agent-card.ts    # Generate/serve /.well-known/agent.json
│   │       ├── task-lifecycle.ts # submitted → working → completed/failed
│   │       ├── discovery.ts     # Find and register remote agents
│   │       └── index.ts
│   │
│   ├── profiles/                # Identity + credential management
│   │   ├── config.ts            # Load/save/validate profiles
│   │   ├── inheritance.ts       # Base + override resolution
│   │   ├── workspace.ts         # arc.json auto-selection
│   │   ├── keyring.ts           # OS keyring integration
│   │   ├── auth.ts              # OAuth/API key/Bedrock/Vertex/Foundry
│   │   ├── detect.ts            # Auto-detect installed tools
│   │   ├── import.ts            # Import from existing tool configs
│   │   ├── shared.ts            # Shared config layer sync
│   │   ├── swap.ts              # Credential hot-swap (experimental)
│   │   └── types.ts
│   │
│   ├── hooks/                   # Built-in hook implementations
│   │   ├── source-classify.ts   # Priority 1: message source detection
│   │   ├── interagent-routing.ts # Priority 2: suppress bot→bot loops
│   │   ├── watchdog-pause.ts    # Priority 5: auto-pause before destructive ops
│   │   ├── risk-detection.ts    # Priority 10: keyword-based risk tiers
│   │   ├── subagent-inject.ts   # Priority 15: inject rules into subagent prompts
│   │   ├── attempt-tracker.ts   # Priority 20: retry counting
│   │   ├── roundtable.ts        # Priority 50: multi-agent orchestration
│   │   ├── memory-sync.ts       # Priority 85: Obsidian sync on session:end
│   │   ├── audit-score.ts       # Priority 90: completion audit (LLM, log-only default)
│   │   └── post-verify.ts       # Priority 95: gateway/service health checks
│   │
│   ├── cli/                     # Commander.js commands
│   │   ├── index.ts             # CLI entry point
│   │   ├── launch.ts            # Launch agent with profile
│   │   ├── profile.ts           # Profile CRUD
│   │   ├── shared.ts            # Shared layer management
│   │   ├── doctor.ts            # Diagnostics
│   │   ├── status.ts            # Multi-runtime status
│   │   ├── setup.ts             # Shell integration
│   │   ├── exec.ts              # Execute with supervision
│   │   ├── audit.ts             # Manual audit commands
│   │   ├── trace.ts             # Query trace history
│   │   └── factory.ts           # Dark Factory mode
│   │
│   ├── tui/                     # Ink terminal UI
│   │   ├── Dashboard.tsx        # Main TUI (profiles, status, quick actions)
│   │   ├── views/
│   │   │   ├── DashView.tsx
│   │   │   ├── ProfilesView.tsx
│   │   │   ├── SessionView.tsx
│   │   │   ├── SettingsView.tsx
│   │   │   ├── DoctorView.tsx
│   │   │   ├── AboutView.tsx
│   │   │   └── ...overlays
│   │   ├── components/
│   │   ├── theme.tsx
│   │   └── render.tsx
│   │
│   ├── dashboard/               # Web observability UI
│   │   ├── server.ts            # Express server
│   │   ├── api.ts               # REST endpoints for traces/sessions/benchmarks
│   │   ├── ui/                  # Frontend (restructured from Supervisor's index.html)
│   │   │   ├── index.html
│   │   │   ├── styles/
│   │   │   ├── scripts/
│   │   │   └── components/      # Chart.js charts, trace inspector, etc.
│   │   ├── ai-analysis.ts       # Optional LLM-powered trace analysis
│   │   └── auto-launch.ts       # Auto-open dashboard
│   │
│   ├── db/                      # SQLite persistence
│   │   ├── schema.ts
│   │   ├── traces.ts
│   │   ├── sessions.ts
│   │   ├── benchmarks.ts
│   │   └── index.ts
│   │
│   └── telemetry/               # OpenTelemetry integration
│       ├── provider.ts          # TracerProvider setup
│       ├── spans.ts             # Span helpers (preflight, postflight, hook, etc.)
│       ├── exporters.ts         # OTLP, console, SQLite exporters
│       └── index.ts
│
├── scripts/                     # Bootstrap, install, release
├── tests/
│   ├── core/
│   ├── adapters/
│   ├── protocols/
│   ├── hooks/
│   ├── e2e/
│   ├── integration/
│   └── benchmarks/
├── docs/
├── assets/
├── SPEC.md                      # This file
├── README.md
├── CHANGELOG.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── tsup.config.ts
```

---

## 4. Process Management

### 4.1 Broker/Pool Pattern

ARC maintains a persistent agent process pool for concurrent requests, with automatic fallback:

```typescript
interface ProcessPool {
  mode: 'direct' | 'broker';

  // Broker mode: persistent background process on Unix domain socket
  // Multiplexes requests with ownership tracking
  // Returns BROKER_BUSY (-32001) when at capacity → client falls back to direct spawn
  broker?: {
    socketPath: string;           // ~/.arc/run/broker.sock
    maxConcurrent: number;        // default: 3
    idleTimeoutMs: number;        // shutdown after idle period
  };

  // Direct mode: spawn agent as child process, stdin/stdout
  // Used as fallback when broker is busy, or for one-off executions
}
```

**Behavior:**
1. `arc launch` checks for running broker → connects if available
2. If broker busy or unavailable → spawn direct child process
3. Broker tracks ownership per socket connection — enables `interrupt` from different callers
4. Session-scoped cleanup on exit: broker shutdown, orphan kill, state prune

### 4.2 Background Job System

Per-workspace state management for long-running agent tasks:

```
~/.arc/jobs/
├── <workspace-slug>-<hash>/
│   ├── state.json               # Job index (max 50 per workspace, pruned by update time)
│   └── <jobId>.json             # Individual job payload + output
```

```typescript
interface BackgroundJob {
  id: string;                    // <prefix>-<base36-timestamp>-<random>
  workspace: string;
  profile: string;
  pid: number;                   // for cancellation
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  created: string;
  updated: string;
  description: string;
  output?: string;               // path to output file
}
```

Jobs are detached child processes with PID tracking. `arc jobs list`, `arc jobs cancel <id>`, `arc jobs output <id>`.

---

## 5. Adapter Interface

Every adapter implements this common interface. Integration depth varies by runtime — Claude Code gets the deepest hooks, Gemini gets process-level wrapping. The core doesn't care.

```typescript
export interface RuntimeAdapter {
  readonly name: string;               // 'claude-code' | 'codex' | 'gemini' | 'openclaw' | string
  readonly capabilities: AdapterCapabilities;

  // Lifecycle
  launch(profile: Profile, options: LaunchOptions): Promise<AgentProcess>;
  terminate(process: AgentProcess): Promise<void>;
  isRunning(process: AgentProcess): boolean;

  // Supervision hooks (called by core pipeline)
  preflight?(ctx: HookContext): Promise<PreflightResult>;
  postflight?(ctx: HookContext, response: AgentResponse): Promise<PostflightResult>;

  // Context injection (adapter-specific mechanism)
  injectContext?(process: AgentProcess, metadata: HookMetadata): Promise<void>;

  // Monitoring
  onOutput?(process: AgentProcess, handler: (data: OutputEvent) => void): void;
  getStatus?(process: AgentProcess): Promise<AgentStatus>;

  // Profile management
  applyProfile?(profile: Profile): Promise<void>;   // Write config files, env vars
  detectInstallation?(): Promise<ToolDetection>;     // Auto-detect installed tool
  importConfig?(toolPath: string): Promise<Partial<Profile>>;
}

export interface AdapterCapabilities {
  hooks: boolean;           // Can fire lifecycle hooks (only Claude Code today)
  sdkControl: boolean;      // Has bidirectional control protocol (only Claude Code)
  pluginSystem: boolean;    // Supports plugins (only Claude Code)
  mcpSupport: boolean;      // Can connect to MCP servers (all three)
  jsonOutput: boolean;      // Structured JSON output (Claude Code, Codex)
  sandboxing: boolean;      // Native sandbox support
  processWrap: boolean;     // Can be wrapped at process level (all)
  remoteSupport: boolean;   // Can run on remote machines
  permissionTier: PermissionTier;  // Three-tier permission model
}

// Three-tier permission model (from claw-code research)
export type PermissionTier = 'coordinator' | 'interactive' | 'worker';
// coordinator: full tool access, can spawn sub-agents, manage tasks
// interactive: standard user-facing permissions, approval-gated
// worker: degraded permissions, no destructive ops, no spawning
```

### 5.1 Claude Code Adapter (Deep Integration)

The richest adapter. Three integration modes available simultaneously:

**SDK Control Protocol** — Bidirectional JSON over stdio. ARC spawns Claude Code via the SDK, then sends/receives control messages:
- `initialize` — register hooks, MCP servers, system prompt, agents
- `can_use_tool` / `set_permission_mode` — permission management
- `mcp_set_servers` — dynamic MCP server management
- `apply_flag_settings` — runtime config changes
- `hook_callback` — respond to hook events
- Full message stream for monitoring

**Plugin System** — ARC registers as a Claude Code plugin:
```
arc-claude-plugin/
├── plugin.json        # Manifest
├── hooks/hooks.json   # All 27 event types
├── commands/          # Custom slash commands
└── agents/            # Custom agent types
```

**HTTP Hooks** — For hooks that need to call back to ARC's supervision pipeline:
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{ "type": "http", "url": "http://localhost:{{ARC_PORT}}/hooks/pre-tool-use" }]
    }],
    "PostToolUse": [{
      "matcher": "*", 
      "hooks": [{ "type": "http", "url": "http://localhost:{{ARC_PORT}}/hooks/post-tool-use" }]
    }]
  }
}
```

**Hook capabilities:**
- `PreToolUse` → can return `permissionDecision` (allow/deny/ask), `updatedInput` (modify tool args), `additionalContext`
- `PostToolUse` → can return `additionalContext`, `updatedMCPToolOutput` (modify tool results)
- `SessionStart` → inject `additionalContext`, set `watchPaths`
- `Stop` → final supervision pass, write traces
- All 27 events available for monitoring

### 5.2 Codex CLI Adapter (Process Wrapper)

```typescript
// Spawn with structured output
const proc = spawn('codex', [
  '--json',
  '--full-stdout',
  '--approval-mode', profile.codex.approvalMode,  // suggest | auto-edit | full-auto
  '--model', profile.model,
  '--project-doc', arcInstructionsPath,            // injected behavioral constraints
  prompt
], { env: profile.env });

// Parse JSON output stream for monitoring
proc.stdout.on('data', (chunk) => {
  const events = parseJsonStream(chunk);
  for (const event of events) {
    pipeline.postflight(event);
    telemetry.recordSpan(event);
  }
});
```

**Integration points:**
- `instructions.md` management — ARC writes behavioral constraints per profile
- `~/.codex/config.yaml` management — model, approval mode, MCP servers
- MCP server — ARC exposes supervision tools that Codex can call
- JSON output stream — real-time monitoring and trace collection
- Sandbox enforcement — leverage OS-level sandboxing in `full-auto` mode

### 5.3 Gemini CLI Adapter (Process Wrapper)

```typescript
const proc = spawn('gemini', [
  '--non-interactive',
  '--model', profile.model,
  prompt
], { env: profile.env });

// stdio capture for monitoring (no structured JSON)
proc.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  heuristics.analyze(text);  // Keyword/pattern-based monitoring
  telemetry.recordSpan({ type: 'output', content: text });
});
```

**Integration points:**
- `GEMINI.md` management — behavioral constraints per profile
- `~/.gemini/settings.json` management — model, MCP servers, sandbox
- MCP server — ARC as tool provider
- stdio capture — heuristic-based monitoring (less structured than Codex)
- Sandbox flag management

### 5.4 OpenClaw Adapter (Plugin)

Maintains the existing `openclaw.plugin.json` structure:

```json
{
  "name": "arc",
  "version": "2.0.0",
  "hooks": {
    "before_prompt_build": { "handler": "openclaw/hooks/before-prompt.ts", "priority": 40 },
    "agent_end": { "handler": "openclaw/hooks/agent-end.ts", "priority": 40 },
    "session_end": { "handler": "openclaw/hooks/session-end.ts", "priority": 40 }
  }
}
```

**Integration points:**
- Full lifecycle hooks via OpenClaw's plugin API
- Interagent routing (source classification + suppress rules)
- Roundtable orchestration (multi-agent turn management)
- Memory sync to Obsidian
- Shared state per session

### 5.5 Generic Adapter (Fallback)

For any agent runtime not explicitly supported:

**MCP Server mode** — ARC exposes 5 supervision tools:
- `expand_intent` — structured intent expansion from raw prompt
- `classify_risk` — deterministic risk tier classification
- `derive_completion` — generate completion checklist
- `audit_completion` — post-execution audit
- `explain_trace` — query and explain debug traces

**HTTP REST mode** — Same capabilities via REST API:
```
POST /api/preflight    { message, sessionId }
POST /api/postflight   { response, sessionId, traces }
GET  /api/traces       ?session=X&limit=50
GET  /api/status       
```

---

## 6. Hook System

### 6.1 Hook Interface

Every hook is a deterministic, synchronous check with optional async post-processing:

```typescript
export interface Hook {
  name: string;
  priority: number;           // lower = runs first; 0-100 range
  enabled: boolean;           // read from config at load time
  events: HookEvent[];        // which lifecycle events trigger this hook

  // Synchronous, deterministic — no LLM, no async, no side effects
  check?(ctx: HookContext): HookResult;

  // Optional: add structured metadata to agent context
  inject?(ctx: HookContext): HookMetadata | undefined;

  // Optional: runs after agent responds (async OK)
  postProcess?(ctx: HookContext, response: AgentResponse): Promise<void>;
}

export type HookEvent =
  | 'pre:message'
  | 'pre:agent:respond'
  | 'post:agent:respond'
  | 'pre:subagent:spawn'
  | 'pre:tool:config'
  | 'pre:tool:gateway'
  | 'pre:tool:exec'
  | 'session:start'
  | 'session:end';

export interface HookResult {
  pass: boolean;
  flag?: boolean;             // pass but surface a warning
  block?: boolean;            // hard block (only in enforce mode)
  reason?: string;
  tier?: RiskTier;
  metadata?: Record<string, unknown>;
}

export interface HookContext {
  message: string;
  source: MessageSource;      // human | agent | system | cron
  sessionId: string;
  agentId: string;
  profile: Profile;           // full profile context
  adapter: string;            // which adapter is active
  config: ArcConfig;
  state: SessionState;
  toolName?: string;
  toolArgs?: unknown;
  spawnTask?: string;
}
```

### 6.2 Enforcement Modes

```typescript
type EnforcementMode = 'off' | 'log' | 'advise' | 'enforce';
```

| Mode | Behavior |
|---|---|
| `off` | Disabled entirely |
| `log` | Runs all hooks, logs results, never blocks or retries **(DEFAULT)** |
| `advise` | Logs + injects suggestions into agent context, no forced retry |
| `enforce` | Logs + injects + forces retry on failed checks (max attempts applies) |

Default is `log`. `enforce` requires explicit opt-in per profile. In `enforce` mode, retry only triggers if audit confidence < 40%.

### 6.3 Built-in Hooks

#### `source-classify` — Priority 1
**Events:** `pre:message`  
Classifies message source by comparing sender ID against known bot accounts and matching cron trigger patterns. Output: `MessageSource = 'human' | 'agent' | 'system' | 'cron'`. Must run first — all other hooks depend on source context.

#### `interagent-routing` — Priority 2
**Events:** `pre:agent:respond`  
Uses source classification + configurable routing rules to suppress bot→bot reply loops. `@mention` override always allows. Injects `{ should_suppress: true }` when suppressing.

#### `watchdog-pause` — Priority 5
**Events:** `pre:tool:config`, `pre:tool:gateway`, matching `pre:tool:exec`  
Auto-pauses external watchdog before destructive operations. Unpauses in `postProcess`. Non-blocking — if watchdog unreachable, skip + log warning.

#### `risk-detection` — Priority 10
**Events:** `pre:message`  
Deterministic keyword match against configurable list → assigns risk tier. Five tiers: `read-only` → `file-modification` → `build-affecting` → `deploy-affecting` → `destructive`. In `enforce` mode only, `destructive` tier can block.

#### `subagent-inject` — Priority 15
**Events:** `pre:subagent:spawn`  
Injects compact rule summary into subagent task prompts. Configurable rule library (e.g., watchdog pause, obsidian sync, no cascade delete).

#### `attempt-tracker` — Priority 20
**Events:** `post:agent:respond`  
Counts attempts per session+turn. In `enforce` mode, forces retry up to max. In `log`/`advise`, only tracks. Never retries in `log` mode.

#### `roundtable` — Priority 50
**Events:** `pre:message`, `pre:agent:respond`, `post:agent:respond`  
Multi-agent discussion orchestration. Detects trigger phrases, manages turn order across agents, records responses per round, signals synthesis when all rounds complete. State:

```typescript
interface RoundtableState {
  id: string;
  topic: string;
  agents: string[];
  modes: Record<string, 'critic' | 'advocate' | 'neutral'>;
  rounds: number;
  currentRound: number;
  currentTurnIndex: number;
  responses: Array<{ agent: string; round: number; content: string }>;
  status: 'active' | 'synthesizing' | 'complete';
  startedAt: string;
}
```

#### `memory-sync` — Priority 85
**Events:** `session:end` (default), optionally `post:agent:respond`  
Compares mtime of mapped memory files against Obsidian counterparts. Configurable sync map. In `log` → flag drift. In `advise` → inject reminder. In `enforce` → auto-sync.

#### `audit-score` — Priority 90
**Events:** `post:agent:respond`  
Runs completion audit (optional LLM call). In `log` → only logs. In `advise` → injects suggestion. In `enforce` → triggers retry only if confidence < 40%. Hard confidence floor prevents marginal retries.

#### `supervision-gate` — Priority 92
**Events:** `post:agent:respond`  
ALLOW/BLOCK gate protocol for substantive code changes. When enabled, a supervisor agent (can be a different profile/runtime) reviews the primary agent's output:

1. Gate only fires for substantive work (file changes, builds, deploys) — not status/reporting turns
2. Supervisor receives: last assistant message, session context, changed files
3. Supervisor must respond with structured first line: `ALLOW: <reason>` or `BLOCK: <reason>`
4. `BLOCK` → primary agent must continue working with the feedback
5. Checks for: second-order failures, empty-state behavior, retry coverage, stale state, rollback risk

```typescript
interface GateConfig {
  enabled: boolean;
  supervisorProfile: string;      // profile to use for review
  timeout: number;                // max review time (default: 15 min)
  onlySubstantive: boolean;       // skip reporting/status turns
  structuredOutput: boolean;      // require ALLOW/BLOCK first line
}
```

In `log` mode → gate runs but result is only traced. In `advise` → result injected as suggestion. In `enforce` → BLOCK forces agent to continue.

#### `post-verify` — Priority 95
**Events:** `post:tool:gateway`, `post:tool:config`  
After service restarts or config changes, polls health endpoints (up to 30s). Injects `{ gateway_healthy, watchdog_healthy, verified_at }`. If service doesn't recover → inject alert, don't block.

---

## 7. Profile System

### 7.1 Profile Structure

```typescript
interface Profile {
  name: string;
  inherits?: string;                    // base profile name
  adapter: AdapterName;                 // claude-code | codex | gemini | openclaw | generic
  
  // Identity
  auth: AuthConfig;                     // OAuth | API key | Bedrock | Vertex | Foundry
  env: Record<string, string>;          // environment variables
  
  // Launch
  launchFlags: string[];                // per-profile persistent flags
  model?: string;                       // default model override
  approvalMode?: string;                // adapter-specific approval mode
  sandbox?: boolean;                    // enable sandboxing
  
  // Supervision
  enforcement: EnforcementMode;         // off | log | advise | enforce
  hooks: Record<string, HookConfig>;    // per-hook enable/disable + config overrides
  maxRetries: number;                   // default: 3
  minConfidenceForRetry: number;        // default: 0.40
  
  // MCP
  mcpServers: Record<string, MCPServerConfig>;  // MCP servers for this profile
  
  // Metadata
  created: string;
  lastUsed?: string;
  tags?: string[];
}
```

### 7.2 Profile Inheritance

Profiles can inherit from a base profile and override specific fields:

```json
{
  "name": "work-claude",
  "inherits": "base-claude",
  "model": "claude-sonnet-4-20250514",
  "enforcement": "advise",
  "hooks": {
    "risk-detection": {
      "customKeywords": ["production", "deploy"]
    }
  }
}
```

Resolution order: profile overrides → base profile → adapter defaults → global defaults.

Deep merge for objects, replace for primitives and arrays. `hooks` config merges per-hook (profile hook config extends base hook config).

### 7.3 Workspace-Aware Auto-Selection (`arc.json`)

Place `arc.json` in a project root to auto-select profile and configuration:

```json
{
  "profile": "work-claude",
  "adapter": "claude-code",
  "enforcement": "advise",
  "hooks": {
    "risk-detection": {
      "blockTier": "deploy-affecting"
    }
  },
  "mcpServers": {
    "project-tools": {
      "command": "npx",
      "args": ["project-mcp-server"],
      "env": {}
    }
  }
}
```

When `arc launch` runs in a directory with `arc.json`, it merges workspace config with the named profile. Workspace config takes highest precedence (overrides even profile settings).

Resolution: `arc.json` → profile → base profile → adapter defaults → global defaults.

---

## 8. Protocol Integration

### 8.1 MCP — Dual Role

**ARC as MCP Host:**
- Connects to external MCP servers on behalf of managed agents
- Manages server lifecycle (start, stop, reconnect)
- Routes MCP tool calls through the supervision pipeline (risk check before tool execution)
- Supports all standard transports: stdio, HTTP, SSE, WebSocket
- Per-profile MCP server configuration

**ARC as MCP Server:**
Exposes 5 supervision tools that any MCP-compatible agent can call:

| Tool | Description |
|---|---|
| `arc_expand_intent` | Expand raw prompt into structured TaskBrief |
| `arc_classify_risk` | Classify risk tier of a message/action |
| `arc_derive_completion` | Generate completion checklist for a task |
| `arc_audit_completion` | Audit whether a task is actually done |
| `arc_explain_trace` | Query and explain debug traces |

This means even agents ARC doesn't directly manage can use its supervision capabilities — just add ARC's MCP server to their config.

### 8.2 A2A — Agent Orchestration

Each ARC-managed agent gets an **Agent Card**:

```json
{
  "name": "claude-work",
  "description": "Claude Code agent for work projects",
  "url": "http://localhost:{{ARC_PORT}}/a2a/claude-work",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "skills": [
    { "id": "code-review", "name": "Code Review", "description": "..." },
    { "id": "implementation", "name": "Implementation", "description": "..." }
  ],
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"]
}
```

**Task lifecycle for cross-agent delegation:**

```
Client Agent                         ARC                          Server Agent
     │                                │                                │
     │── POST /a2a/tasks/send ──────→│                                │
     │   { task, message }            │── route to adapter ──────────→│
     │                                │                                │── execute
     │                                │←── status: working ───────────│
     │←── status: working ───────────│                                │
     │                                │                                │── done
     │                                │←── status: completed ─────────│
     │←── status: completed ─────────│                                │
     │   { artifacts }                │                                │
```

**Roundtable via A2A:**
The roundtable hook uses A2A's task model internally — each agent's turn is a task with `submitted → working → completed` lifecycle. This replaces the custom state machine with a standard protocol.

### 8.3 Remote Agent Support

ARC isn't limited to local CLI agents. The protocol layer supports remote agents:

**Remote supervision via MCP:**
- Remote agent connects to ARC's MCP server (HTTP/SSE transport)
- ARC supervision tools available over the network
- No process-level wrapping needed — agent calls ARC's tools voluntarily

**Remote supervision via A2A:**
- Remote agent has an Agent Card with its network endpoint
- ARC sends tasks and receives results via HTTP
- Full trace collection over the wire

**Remote supervision via HTTP adapter:**
- Generic HTTP REST API for any runtime
- `POST /api/preflight`, `POST /api/postflight`
- Agent calls ARC before/after execution

**SSH-based remote wrapping:**
- For CLI agents running on remote machines
- ARC spawns via SSH, captures stdio
- Same adapter interface, transport is SSH instead of local process

---

## 9. Circuit Breaker

Prevents cascading failures when an agent or service is degraded.

```typescript
interface CircuitBreakerConfig {
  maxConsecutiveFailures: number;    // default: 3
  degradeAction: 'log' | 'pause' | 'alert';  // what to do when tripped
  resetAfterMinutes: number;        // auto-reset after cooldown
  serialFallback: boolean;          // fall back to serial execution (disable parallelism)
  notifyChannels: string[];         // where to send alerts
}

interface CircuitBreakerState {
  failures: number;
  lastFailure?: string;
  tripped: boolean;
  trippedAt?: string;
  degradedTo?: EnforcementMode;
}
```

**Behavior:**
1. Track consecutive hook/audit failures per session
2. At threshold (default: 3) → trip the breaker
3. Tripped actions:
   - Degrade enforcement mode to `log` (never force retries when things are broken)
   - Fire alert to configured channels
   - If `serialFallback`: disable parallel agent execution, switch to sequential
   - Log circuit breaker event as a trace
4. Auto-reset after cooldown period or manual reset via `arc reset-breaker`

---

## 10. OpenTelemetry Integration

Every supervision decision produces a structured trace. ARC integrates with OpenTelemetry for export to any observability backend.

```typescript
// Span hierarchy
arc.session                          // root span per session
  ├── arc.preflight                  // preflight pipeline
  │   ├── arc.hook.source-classify
  │   ├── arc.hook.risk-detection
  │   └── arc.hook.interagent-routing
  ├── arc.agent.execution            // agent work
  │   ├── arc.tool.use               // individual tool calls (from hooks)
  │   └── arc.agent.output
  ├── arc.postflight                 // postflight pipeline
  │   ├── arc.hook.audit-score
  │   ├── arc.hook.post-verify
  │   └── arc.hook.memory-sync
  └── arc.circuit-breaker            // if tripped
```

**Attributes on every span:**
- `arc.profile` — active profile name
- `arc.adapter` — adapter type
- `arc.session_id` — session identifier
- `arc.enforcement_mode` — current mode
- `arc.risk_tier` — classified risk tier (if applicable)
- `arc.hook.name` — hook that produced this span
- `arc.hook.result` — pass/flag/block

**Export targets:**
- SQLite (built-in, always on — powers the dashboard)
- OTLP (gRPC or HTTP) — for Jaeger, Grafana Tempo, Honeycomb, etc.
- Console (debug mode)

---

## 11. Dark Factory Mode

The endgame: fully autonomous agent execution. Spec in → software out, with ARC as the control plane.

```
┌─────────────────────────────────────────────────┐
│                 Dark Factory                      │
│                                                   │
│  Spec (arc.json + task definition)                │
│    ↓                                              │
│  [Planner Agent]  — breaks spec into waves        │
│    ↓                                              │
│  [Wave Executor]  — parallel independent tasks    │
│    ├── Agent A (impl task 1)                      │
│    ├── Agent B (impl task 2)                      │
│    └── Agent C (impl task 3)                      │
│    ↓                                              │
│  [Verifier Agent] — read-only, cannot modify      │
│    ↓                                              │
│  [Consensus Gate] — architect reviews high-risk   │
│    ↓                                              │
│  [Next Wave] or [Complete]                        │
│                                                   │
│  Circuit breaker: 3 failures → serial fallback    │
│  All traces → OpenTelemetry                       │
│  All decisions → SQLite audit trail               │
└─────────────────────────────────────────────────┘
```

**Key patterns (absorbed from research):**
- **Scratchpad protocol** — structured `DONE|{path}` handoffs between agents
- **Wave-based parallel execution** — group independent tasks, verify at wave boundary
- **Read-only verifier** — separate agent that cannot modify files, only validates
- **Consensus gate** — architect agent reviews high-risk changes before merge
- **Circuit breaker** — 3 consecutive failures → degrade + alert + serial fallback

**CLI entry:**
```bash
arc factory run --spec ./factory-spec.yaml --profile work-claude
arc factory status
arc factory abort
```

**Factory spec format:**
```yaml
name: "Feature X Implementation"
repo: "./my-project"
profile: work-claude
waves:
  - name: "Foundation"
    tasks:
      - description: "Create database schema"
        files: ["src/db/schema.ts"]
        risk: file-modification
      - description: "Create API types"
        files: ["src/types/api.ts"]
        risk: file-modification
  - name: "Implementation"
    tasks:
      - description: "Implement API endpoints"
        files: ["src/routes/*.ts"]
        risk: build-affecting
        depends_on: ["Foundation"]
  - name: "Verification"
    verifier: true
    tasks:
      - description: "Run tests, verify types, review code"
        read_only: true
consensus_gate:
  enabled: true
  reviewer_profile: work-soren
  threshold: build-affecting
```

Dark Factory is a **future feature** — the architecture supports it, but implementation is post-MVP. The core patterns (waves, verifier, consensus) inform the hook pipeline design today.

---

## 12. Memory System

Hierarchical memory with aging, relevance search, and cross-agent sharing. Inspired by claw-code's 8-module memdir architecture, adapted for ARC's multi-runtime context.

### 12.1 Memory Layers

```typescript
interface MemoryEntry {
  id: string;
  content: string;
  type: 'fact' | 'preference' | 'correction' | 'pattern' | 'decision';
  scope: MemoryScope;
  createdAt: string;
  lastAccessed: string;
  accessCount: number;
  ttl?: number;              // seconds until decay starts
  relevanceScore: number;    // 0-1, decays over time
  tags: string[];
  sourceSession: string;
  sourceAgent?: string;
}

type MemoryScope = 'session' | 'persistent' | 'team';
```

| Scope | Lifetime | Visibility | Storage |
|---|---|---|---|
| **Session** | Current session only | Single agent | In-memory |
| **Persistent** | Cross-session, decays via TTL | Single profile | SQLite (`~/.arc/db/`) |
| **Team** | Cross-session, shared | All agents in a team/roundtable | SQLite, synced via A2A or shared filesystem |

### 12.2 Memory Aging & TTL

Memories decay in relevance over time. Each access refreshes the score.

```typescript
function decayScore(entry: MemoryEntry, now: Date): number {
  const age = (now.getTime() - new Date(entry.lastAccessed).getTime()) / 1000;
  const halfLife = entry.ttl ?? 86400 * 7;  // default: 7 days
  const decay = Math.pow(0.5, age / halfLife);
  const accessBoost = Math.min(entry.accessCount * 0.05, 0.3);
  return Math.min(1, entry.relevanceScore * decay + accessBoost);
}
```

Memories below a configurable threshold (default: 0.1) are archived, not deleted. Archived memories are excluded from search but recoverable.

### 12.3 Relevance Search

Context-aware memory retrieval. Given a prompt/task, find applicable memories:

1. **Keyword match** — tokenize input, match against memory content and tags (fast, deterministic)
2. **Scope filter** — session > persistent > team (narrowest scope first)
3. **Recency bias** — recently accessed memories score higher
4. **Type weighting** — corrections and preferences rank above facts

No embedding search in v1 — deterministic keyword + recency is faster and more predictable. Embedding-based search is a future enhancement.

### 12.4 Auto-Extraction

After each agent turn, scan the conversation for extractable memories:

- **User corrections** → `type: 'correction'`, high relevance, long TTL
- **Stated preferences** → `type: 'preference'`, high relevance
- **Discovered patterns** → `type: 'pattern'`, medium relevance
- **Decisions made** → `type: 'decision'`, linked to session context

Extraction uses heuristic keyword/pattern matching (deterministic). Optional LLM-enhanced extraction for `advise`/`enforce` modes.

### 12.5 Team Memory

In multi-agent setups (roundtable, Dark Factory), team memory provides shared context:

- Agents can read/write to team memory scope
- Conflict resolution: last-write-wins with merge logging
- Team memories are tagged with source agent
- Roundtable decisions auto-written to team memory
- Sync via A2A task artifacts or shared SQLite

### 12.6 Dream — Background Memory Consolidation

Automated memory consolidation task that runs in the background (or on-demand). Reviews recent session transcripts and synthesizes durable memories.

```typescript
interface DreamTask {
  type: 'dream';
  status: 'running' | 'completed' | 'killed';
  phase: 'orient' | 'gather' | 'consolidate' | 'prune';
  sessionsReviewing: string[];
  filesTouched: string[];
  abortController: AbortController;
}
```

**Phases:**
1. **Orient** — scan existing memory files, read index, understand current state
2. **Gather** — search recent transcripts for new signal (corrections, patterns, decisions)
3. **Consolidate** — merge new signal into existing memories, resolve contradictions, convert relative dates to absolute
4. **Prune** — update index, remove stale pointers, keep index under size budget

**Trigger modes:**
- `arc memory dream` — manual trigger
- Auto-dream after N sessions (configurable, default: off)
- Scheduled via cron (`arc cron create --type dream --schedule "0 3 * * *"`)

Dreams use the active profile's LLM. The dream prompt is deterministic — the agent decides what to consolidate.

### 12.7 External Sync

Memory syncs to external systems via configurable sync map:

```json
{
  "memory": {
    "syncTargets": {
      "obsidian": {
        "enabled": true,
        "vaultPath": "/home/bailey/obsidian-vault",
        "syncMap": {
          "persistent:decisions": "3. System/Operations/Decisions.md",
          "persistent:learnings": "3. System/Agents/Learnings.md"
        }
      }
    }
  }
}
```

---

## 13. Skill System

Skills are higher-level than tools — reusable, composable procedures that agents can learn, share, and create. Inspired by claw-code's 20-module skill architecture.

### 13.1 Skill Structure

```typescript
interface Skill {
  name: string;
  description: string;
  trigger: string[];          // patterns that activate this skill
  steps: SkillStep[];         // ordered steps
  tools: string[];            // required tools
  adapters: string[];         // compatible adapters (empty = all)
  source: 'builtin' | 'user' | 'generated' | 'mcp';
  created: string;
  lastUsed?: string;
  successRate: number;        // tracked over invocations
}

interface SkillStep {
  action: string;             // tool call, prompt, or sub-skill
  description: string;
  conditional?: string;       // skip if condition not met
  onError: 'retry' | 'skip' | 'abort';
}
```

### 13.2 Skill Loading

Directory-based — drop a file, get a skill:

```
~/.arc/skills/
├── code-review.yaml        # User-created skill
├── deploy-check.yaml       # User-created skill
└── generated/              # Agent-generated skills (via skillify)
    ├── fix-eslint.yaml
    └── setup-vitest.yaml
```

Skills also loaded from:
- Built-in skills bundled with ARC
- MCP tool adapters (any MCP tool wrapped as a skill)
- Profile-specific skills (in `~/.arc/profiles/<name>/skills/`)

### 13.3 MCP-to-Skill Adapter

Wraps any MCP tool as a skill automatically:

```typescript
function mcpToSkill(tool: MCPTool): Skill {
  return {
    name: `mcp:${tool.name}`,
    description: tool.description,
    trigger: [tool.name, ...extractKeywords(tool.description)],
    steps: [{ action: `mcp:${tool.name}`, description: tool.description, onError: 'abort' }],
    tools: [tool.name],
    adapters: [],
    source: 'mcp',
    created: new Date().toISOString(),
    successRate: 1.0
  };
}
```

### 13.4 Skillify — Self-Improving Skills

Meta-skill that observes agent actions and generates new skills from demonstrated patterns:

1. **Observation** — track sequences of tool calls that accomplish a coherent task
2. **Pattern detection** — identify repeated 3+ step sequences across sessions
3. **Skill generation** — create a new skill definition from the observed pattern
4. **Validation** — test the generated skill on a similar task
5. **Registration** — save to `~/.arc/skills/generated/` if validation passes

```bash
# Manual trigger
arc skill create --from-session <sessionId>  # generate skill from session transcript
arc skill create --interactive               # guided skill creation

# Automatic (when enabled)
# Agent detects: "I've done this 3 times" → generates skill → asks user to approve
```

Skillify respects the enforcement mode — in `log` mode it suggests skills, in `advise` it prompts the user, in `enforce` it auto-creates (with user notification).

### 13.5 Skill-as-Contract (Negative Boundaries)

Skills should define what an agent **CAN'T** do, not just what it can. Contract skills set behavioral boundaries:

```yaml
name: safe-deployment
type: contract
description: "Safety boundaries for deployment operations"
constraints:
  - "NEVER auto-apply review fixes — always present for approval"
  - "NEVER run destructive operations without explicit confirmation"
  - "NEVER bypass the consensus gate for build-affecting changes"
  - "Always verify rollback path exists before deploy"
required_for:
  - risk_tier: deploy-affecting
  - risk_tier: destructive
```

Contract skills are automatically loaded when risk classification triggers their `required_for` conditions. They inject constraints into the agent context before execution.

### 13.6 Structured Review Schema

Standard output format for any code review hook or supervision gate:

```typescript
interface ReviewOutput {
  verdict: 'approve' | 'needs-attention';
  summary: string;
  findings: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    title: string;
    body: string;
    file?: string;
    line_start?: number;
    line_end?: number;
    confidence: number;        // 0-1
    recommendation: string;
  }>;
  next_steps: string[];
}
```

Used by: `supervision-gate` hook, `arc review` command, Dark Factory verifier agent. The confidence + severity fields enable threshold-based auto-gating.

### 13.7 Stuck Detector

Self-aware recovery when an agent detects it's looping:

```typescript
interface StuckDetection {
  maxSimilarAttempts: number;   // default: 3
  similarityThreshold: number;  // default: 0.85
  recoveryStrategies: Array<'backtrack' | 'reframe' | 'escalate' | 'abort'>;
}
```

Detection: compare the last N tool calls / outputs for high similarity. If stuck:
1. **Backtrack** — revert to last known good state
2. **Reframe** — inject a "you appear stuck, try a different approach" prompt
3. **Escalate** — hand off to a different agent (roundtable) or alert the user
4. **Abort** — stop execution, write trace, report

---

## 14. Task Management

Tasks are first-class tools, not a separate API. Any agent managed by ARC can create, query, update, and complete tasks. This enables agent-to-agent delegation without custom protocols.

### 14.1 Task Tools

Exposed as both MCP tools (for agents) and CLI commands (for operators):

| Tool | Description |
|---|---|
| `TaskCreate` | Create a new task with description, assignee, priority, risk tier |
| `TaskGet` | Get task details by ID |
| `TaskList` | List tasks with filters (status, assignee, priority) |
| `TaskUpdate` | Update task fields (status, description, assignee) |
| `TaskStop` | Cancel a running task |
| `TaskOutput` | Attach output/artifacts to a completed task |
| `CronCreate` | Schedule a recurring task |
| `CronDelete` | Remove a scheduled task |
| `CronList` | List scheduled tasks |
| `SendMessage` | Send a message to another agent (by profile name or A2A agent card) |

### 14.2 Task Lifecycle

```
created → assigned → working → [input-required] → completed | failed | cancelled
```

Maps directly to A2A task states. When A2A is enabled, tasks are interoperable with external A2A agents. When A2A is disabled, tasks are local-only in SQLite.

### 14.3 Agent-to-Agent Messaging

`SendMessage` enables direct communication between ARC-managed agents:

```typescript
interface AgentMessage {
  from: string;       // profile name or agent ID
  to: string;         // profile name, agent ID, or A2A endpoint
  content: string;
  type: 'request' | 'response' | 'notification' | 'handoff';
  taskId?: string;    // link to a task
  metadata?: Record<string, unknown>;
}
```

Messages are routed through the hook pipeline — `interagent-routing` hook applies suppress rules, `source-classify` tags the source. This prevents bot→bot loops while allowing intentional cross-agent communication.

---

## 15. Prompt Routing

Score-based intent routing that auto-dispatches prompts to the correct tool, skill, or adapter without requiring explicit command prefixes.

### 15.1 How It Works

```typescript
interface RouteResult {
  target: 'tool' | 'skill' | 'adapter' | 'command' | 'passthrough';
  name: string;
  confidence: number;    // 0-1
  matchedTokens: string[];
}

function routePrompt(input: string, registries: Registries): RouteResult[] {
  const tokens = tokenize(input);  // lowercase, strip punctuation, extract keywords
  const candidates: RouteResult[] = [];

  // Score against tool registry
  for (const tool of registries.tools) {
    const score = scoreMatch(tokens, tool.name, tool.description, tool.keywords);
    if (score > 0.3) candidates.push({ target: 'tool', name: tool.name, confidence: score, matchedTokens: [...] });
  }

  // Score against skill registry
  for (const skill of registries.skills) {
    const score = scoreMatch(tokens, skill.name, ...skill.trigger);
    if (score > 0.3) candidates.push({ target: 'skill', name: skill.name, confidence: score, matchedTokens: [...] });
  }

  // Score against CLI commands
  for (const cmd of registries.commands) {
    const score = scoreMatch(tokens, cmd.name, cmd.description);
    if (score > 0.3) candidates.push({ target: 'command', name: cmd.name, confidence: score, matchedTokens: [...] });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}
```

### 15.2 Routing Behavior

- Confidence ≥ 0.8 → auto-dispatch (no confirmation needed)
- Confidence 0.5–0.8 → suggest to user/agent, await confirmation
- Confidence < 0.5 → passthrough (no routing, agent handles normally)
- Multiple high-confidence matches → present options

Routing is deterministic (tokenization + keyword scoring). No LLM in the routing path.

---

## 16. Context Management

Long-running agent sessions accumulate context. ARC manages context windows to prevent degradation.

### 16.1 Auto-Compaction

After a configurable number of turns (default: 12), ARC triggers context compaction:

1. **Token budget check** — estimate token count of session context
2. **If over budget** → generate a compact summary of the conversation so far
3. **Replace** old context with summary + recent turns (keep last 3-4 turns verbatim)
4. **Trace** the compaction event (what was summarized, tokens saved)

Compaction uses the active agent's LLM (via the adapter). The compaction prompt is deterministic — the LLM call is the only non-deterministic part.

### 16.2 Streaming Event Taxonomy

ARC defines a standard event stream for monitoring agent execution:

```typescript
type StreamEvent =
  | { type: 'message_start'; sessionId: string; turn: number }
  | { type: 'command_match'; command: string; confidence: number }
  | { type: 'tool_match'; tool: string; confidence: number }
  | { type: 'permission_check'; tool: string; tier: PermissionTier; result: 'allow' | 'deny' | 'ask' }
  | { type: 'message_delta'; content: string }
  | { type: 'message_stop'; reason: string }
  | { type: 'compaction'; turnsBefore: number; turnsAfter: number; tokensSaved: number }
  | { type: 'phase_change'; phase: AgentPhase }  // semantic phase tracking
  | { type: 'stuck_detected'; strategy: string }
  | { type: 'circuit_break'; failures: number };
```

### 16.3 Three-Tier Permission Model

Permission enforcement varies by tier. Each launched agent gets a tier based on its role:

| Tier | Tool Access | Can Spawn | Can Delete | Approval Mode |
|---|---|---|---|---|
| **Coordinator** | Full | Yes (spawn workers) | With confirmation | Bypass |
| **Interactive** | Standard | Limited (sub-agents only) | With confirmation | User-gated |
| **Worker** | Degraded | No | No | Auto-deny destructive |

```typescript
interface PermissionPolicy {
  tier: PermissionTier;
  allowPrefixes: string[];     // tool name prefixes allowed
  denyPrefixes: string[];      // tool name prefixes blocked
  requireApproval: string[];   // tools that always need approval at this tier
  auditLog: boolean;           // log all permission decisions
}
```

Workers spawned by Dark Factory or roundtable default to `worker` tier. The orchestrating agent runs as `coordinator`. Interactive CLI sessions are `interactive`.

---

## 17. Cloud Sync & Backend

ARC is **local-first** — everything works offline from `~/.arc/`. Cloud sync is optional, pluggable, and never required. ARC is a general-purpose tool — it ships with multiple sync providers and anyone can add more.

### 17.1 Design Constraints

1. **Offline-first** — ARC must work fully without network. Sync is a bonus, not a dependency.
2. **Credentials never leave the device** — OS keyring stays local. Only non-secret profile data syncs.
3. **Conflict resolution** — last-write-wins with conflict logging. Future: merge strategies for skills/memory.
4. **Pluggable backends** — multiple built-in providers, plus a plugin interface for custom backends.
5. **Selective sync** — user controls what syncs. Profiles can be marked `local-only`.
6. **No vendor lock-in** — sync data is portable. Export/import between providers.

### 17.2 SyncProvider Interface

```typescript
export interface SyncProvider {
  readonly name: string;          // 'axiom-vault' | 'git' | 's3' | string

  // Lifecycle
  connect(config: SyncConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Auth (delegated to provider)
  login(credentials: ProviderCredentials): Promise<SyncSession>;
  logout(): Promise<void>;
  getUser(): SyncUser | null;

  // Device management
  registerDevice(deviceName: string, platform: string): Promise<DeviceId>;
  listDevices(): Promise<SyncDevice[]>;

  // Data sync
  push(key: string, value: unknown): Promise<void>;
  pull(key: string): Promise<unknown | null>;
  pullAll(prefix?: string): Promise<Record<string, unknown>>;
  delete(key: string): Promise<void>;

  // Realtime (optional)
  subscribe?(key: string, callback: (change: SyncChange) => void): Unsubscribe;

  // Batch
  pushBatch(entries: Record<string, unknown>): Promise<void>;
  pullSince(cursor: string): Promise<SyncDelta>;
}
```

### 17.3 Sync Data Model

What crosses the wire (regardless of provider):

| Data | Sync Key | Syncs? | Notes |
|---|---|---|---|
| Profile definitions | `profiles/<name>.json` | ✅ | JSON, minus credentials |
| Global config | `config/global.json` | ✅ | Enforcement mode, defaults |
| Hook configs | `config/hooks.json` | ✅ | Per-hook enable/disable |
| User skills | `skills/<name>.yaml` | ✅ | Definitions only |
| Generated skills (skillify) | `skills/generated/<name>.yaml` | ✅ | Cross-device learning |
| Persistent memories | `memory/<id>.json` | ✅ | Persistent scope only |
| Team memories | `memory/team/<id>.json` | ✅ | Shared across agents |
| Plugin list | `plugins/installed.json` | ✅ | Names + versions |
| Preferences | `preferences.json` | ✅ | Theme, TUI, dashboard |
| Credentials | — | ❌ | OS keyring, never leaves device |
| Session memory | — | ❌ | Ephemeral, per-session |
| Full traces | — | ❌ | Too large, local SQLite only |
| Process state | — | ❌ | PIDs, sockets, broker — device-specific |
| Active sessions | — | ❌ | Runtime state |

All syncable data is serialized to flat JSON/YAML files under a common key structure. This means every provider — git, filesystem, S3, or API-based — works against the same data shape. Export/import between providers is trivial: it's just copying files.

### 17.4 Built-in Providers

ARC ships with three sync providers out of the box. No plugins required.

#### `git` — Git Repository Sync

The most portable option. Sync data lives in a git repo — any host (GitHub, GitLab, self-hosted, bare repo on a NAS).

```typescript
class GitSyncProvider implements SyncProvider {
  readonly name = 'git';

  // Repo structure mirrors the sync key layout:
  // arc-sync-repo/
  // ├── profiles/
  // ├── config/
  // ├── skills/
  // ├── memory/
  // └── preferences.json

  async connect(config: SyncConfig) {
    // Clone or open existing repo at config.path
    // If remote URL provided, set origin
  }

  async push(key, value) {
    // Write file at key path → git add → git commit → git push
    // Commit message: "arc: update <key>"
  }

  async pull(key) {
    // git pull → read file at key path
  }

  async pullSince(cursor) {
    // cursor = last known commit hash
    // git log --since=cursor → return changed files as delta
  }
}
```

**Config:**
```json
{
  "sync": {
    "provider": "git",
    "git": {
      "repo": "git@github.com:user/arc-sync.git",
      "branch": "main",
      "localPath": "~/.arc/sync-repo",
      "autoCommit": true,
      "autoPush": true,
      "commitPrefix": "arc:"
    }
  }
}
```

**Pros:** Works with any git host. Version history for free. Teams can share a repo. Merge conflicts handled by git.
**Cons:** No realtime push. Requires git installed. Merge conflicts can be messy for JSON files.

#### `filesystem` — Shared Filesystem Sync

For local networks — NFS mount, SMB share, Syncthing folder, Dropbox, or any shared directory.

```typescript
class FilesystemSyncProvider implements SyncProvider {
  readonly name = 'filesystem';

  // Simply reads/writes to a shared directory
  // Uses file mtime for change detection
  // Lockfile-based conflict prevention

  async connect(config: SyncConfig) {
    // Verify config.path exists and is writable
    // Create lockfile for this device
  }

  async push(key, value) {
    // Atomic write: temp file → rename at key path
    // Update manifest.json with mtime + device ID
  }

  async pull(key) {
    // Read file at key path
    // Compare mtime against local version
  }

  async pullSince(cursor) {
    // cursor = last sync timestamp
    // Scan manifest.json for files modified since cursor
  }
}
```

**Config:**
```json
{
  "sync": {
    "provider": "filesystem",
    "filesystem": {
      "path": "/mnt/nas/arc-sync",
      "lockTimeout": 5000,
      "watchInterval": 10000
    }
  }
}
```

**Pros:** Dead simple. No account needed. Works on local network without internet. Syncthing/Dropbox gives you cloud sync without a server.
**Cons:** No auth. No realtime events (polling only). Conflict resolution is basic (mtime-based).

#### `s3` — S3-Compatible Object Storage

For cloud-native setups. Works with AWS S3, MinIO, Cloudflare R2, Backblaze B2, or any S3-compatible API.

```typescript
class S3SyncProvider implements SyncProvider {
  readonly name = 's3';

  // Objects stored at: s3://bucket/arc/<userId>/<key>
  // Uses ETags for change detection
  // Versioning for conflict recovery (if bucket versioning enabled)

  async connect(config: SyncConfig) {
    // Initialize S3 client with credentials
  }

  async push(key, value) {
    // PutObject to s3://bucket/arc/<userId>/<key>
    // Content-Type: application/json
  }

  async pull(key) {
    // GetObject from s3://bucket/arc/<userId>/<key>
  }

  async pullSince(cursor) {
    // ListObjectsV2 with prefix, filter by LastModified > cursor
  }
}
```

**Config:**
```json
{
  "sync": {
    "provider": "s3",
    "s3": {
      "bucket": "my-arc-sync",
      "region": "us-east-1",
      "prefix": "arc/",
      "endpoint": null,
      "accessKeyId": "${ARC_S3_ACCESS_KEY}",
      "secretAccessKey": "${ARC_S3_SECRET_KEY}"
    }
  }
}
```

**Pros:** Scales infinitely. Works with many providers (AWS, MinIO, R2, B2). Bucket versioning gives free backup.
**Cons:** Requires cloud account. No realtime. Credentials management.

### 17.5 Plugin Providers

Additional providers can be installed as plugins:

| Provider Plugin | Use Case |
|---|---|
| `sync-axiom-vault` | Axiom-Labs identity platform. Full auth, realtime SSE, device management, SSO across Axiom apps. |
| `sync-webdav` | WebDAV/CalDAV servers. Nextcloud, ownCloud, etc. |
| `sync-redis` | Redis/Valkey for fast team sync. Pub/sub for realtime. |
| Custom | Any backend via the SyncProvider interface. |

**Axiom-Vault plugin** (`arc plugin install sync-axiom-vault`):
- Uses `@axiom-labs/vault` SDK
- Full auth (email/password, invite-only, future OAuth/SSO)
- Realtime sync via PocketBase SSE subscriptions
- Device management (register, list, last-seen)
- SSO across ClawPort, Agent-Forge, Voxel, SubFrame
- This is the provider Axiom-Labs uses internally, but it's not bundled — it's a first-party plugin

### 17.6 Sync Configuration

```json
{
  "sync": {
    "enabled": true,
    "provider": "axiom-vault",
    "url": "https://vault.axiom-labs.cloud",
    "autoSync": true,
    "syncIntervalMs": 30000,
    "syncOnLaunch": true,
    "syncOnExit": true,
    "localOnlyProfiles": ["dev-local"],
    "exclude": ["traces/*", "jobs/*"]
  }
}
```

### 17.7 Sync Flow

```
arc launch (or any mutation)
    ↓
[Local write to ~/.arc/]
    ↓ (if sync enabled)
[SyncProvider.push(key, value)]
    ↓
[Axiom-Vault stores per-user per-app]
    ↓ (realtime SSE to other devices)
[Other ARC instances receive update]
    ↓
[Merge into local ~/.arc/]
    ↓ (conflict?)
[Last-write-wins + conflict log]
```

**First launch on new device:**
1. `arc login` — authenticate with Axiom-Vault
2. `arc sync pull` — download all profile/skill/memory data
3. `arc setup` — install shims, shell integration (local)
4. Credentials: user must re-auth with each agent CLI locally (credentials never sync)

### 17.8 Sync Auth Model

Sync provider auth is provider-specific:

| Provider | Auth Method |
|---|---|
| `git` | SSH keys or git credential helper (already configured on device) |
| `filesystem` | Filesystem permissions (no auth layer) |
| `s3` | AWS-style access key + secret key (env vars or config) |
| `axiom-vault` (plugin) | Email/password → JWT. Future: OAuth2 SSO across Axiom apps. |

`arc login` prompts for provider-specific credentials. Tokens/sessions are stored locally in `~/.arc/sync/auth.json` (encrypted with OS keyring where available).

For providers without auth (git via SSH, filesystem), `arc login` is a no-op — the provider uses whatever credentials the OS already has.

### 17.9 Credential & Secret Sync

Agent credentials (OAuth tokens, API keys, cloud creds) are the most valuable and most dangerous data ARC manages. The default stance is **credentials stay local** — but ARC supports optional encrypted credential sync for users who need cross-device access.

#### Design Principles

1. **Never sync plaintext secrets.** All credential sync uses envelope encryption — secrets are encrypted before they leave the device.
2. **Master passphrase required.** Credential sync is gated behind a user-chosen passphrase that never leaves the device and is never stored. No passphrase = no credential sync.
3. **Per-secret opt-in.** Not all credentials sync. Each secret is individually flagged `sync: true | false`. Default: `false`.
4. **Audit every access.** Every credential read, write, sync, and agent injection is logged to the local audit trail.
5. **Revocable per-device.** If a device is compromised, you can revoke its decryption key without rotating every secret.

#### Encrypted Credential Store

```typescript
interface CredentialStore {
  // Local store (always available)
  set(name: string, value: string, options?: CredentialOptions): Promise<void>;
  get(name: string): Promise<string | null>;
  list(): Promise<CredentialEntry[]>;
  delete(name: string): Promise<void>;

  // Sync (opt-in, requires master passphrase)
  enableSync(passphrase: string): Promise<void>;
  disableSync(): Promise<void>;
  pushCredentials(): Promise<SyncResult>;
  pullCredentials(passphrase: string): Promise<SyncResult>;
  revokeDevice(deviceId: string): Promise<void>;
}

interface CredentialOptions {
  sync: boolean;              // default: false — must explicitly opt-in
  profile?: string;           // scope to a specific profile (null = global)
  adapter?: string;           // scope to a specific adapter
  type: CredentialType;       // categorization for UI and policy
  rotateAfterDays?: number;   // optional rotation reminder
  tags?: string[];            // for filtering/grouping
}

type CredentialType =
  | 'api-key'          // API keys (Anthropic, OpenAI, Google, etc.)
  | 'oauth-token'      // OAuth access/refresh tokens
  | 'ssh-key'          // SSH private keys
  | 'cloud-credential' // AWS/GCP/Azure creds
  | 'service-token'    // Service-specific tokens (GitHub PAT, etc.)
  | 'certificate'      // TLS certs, signing keys
  | 'passphrase'       // Passwords, passphrases
  | 'custom';          // User-defined

interface CredentialEntry {
  name: string;
  type: CredentialType;
  profile?: string;
  adapter?: string;
  sync: boolean;
  created: string;
  lastAccessed: string;
  lastRotated?: string;
  rotateAfterDays?: number;
  tags: string[];
  // value is NEVER in this listing — only retrieved via get()
}
```

#### Encryption Model

```
Master Passphrase (user-chosen, never stored)
    ↓ Argon2id (memory-hard KDF)
Master Key (derived, held in memory only during session)
    ↓ AES-256-GCM
Per-Secret Encryption (each secret encrypted individually)
    ↓
Encrypted Blob (synced via provider)
    ↓ (on target device)
Master Passphrase (re-entered on first pull)
    ↓ Argon2id
Master Key → AES-256-GCM decrypt → plaintext secret (into OS keyring)
```

**Key details:**
- Argon2id with high memory cost (64MB) and time cost (3 iterations) — resistant to brute force
- Each secret gets its own AES-256-GCM nonce — no nonce reuse
- Encrypted blobs include metadata (name, type, profile, tags) in the clear — only the value is encrypted
- Master key is derived per-session, held in memory, never written to disk
- On first setup: `arc secrets enable-sync` → prompts for passphrase → derives key → encrypts existing opt-in secrets → pushes to sync provider
- On new device: `arc secrets pull` → prompts for passphrase → derives key → decrypts → stores in local OS keyring

**Sync format (what the provider stores):**
```json
{
  "version": 1,
  "kdf": "argon2id",
  "kdfParams": { "memory": 65536, "time": 3, "parallelism": 1 },
  "secrets": [
    {
      "name": "anthropic-api-key",
      "type": "api-key",
      "profile": "work-claude",
      "nonce": "base64...",
      "ciphertext": "base64...",
      "tag": "base64...",
      "created": "2026-04-01T...",
      "tags": ["llm", "production"]
    }
  ],
  "devices": [
    { "id": "laptop-abc", "name": "MacBook Pro", "registered": "2026-04-01T...", "lastSync": "..." },
    { "id": "server-xyz", "name": "Docker-Server", "registered": "2026-04-01T...", "lastSync": "..." }
  ]
}
```

This file syncs via the same provider as everything else (git, filesystem, S3). The encryption is provider-agnostic — the provider just stores opaque blobs.

#### Local Storage

On each device, decrypted secrets go into the **OS keyring** (macOS Keychain, Windows Credential Manager, Linux libsecret/gnome-keyring) with fallback to an encrypted file at `~/.arc/secrets/vault.enc` (encrypted with a device-specific key derived from machine ID + user passphrase).

```
~/.arc/secrets/
├── vault.enc              # Encrypted fallback (when no OS keyring)
├── sync-state.json        # Last sync timestamp, device registration
└── audit.log              # Local credential access log
```

#### CLI

```bash
arc secret set anthropic-key "sk-ant-..." --type api-key --profile work-claude
arc secret set github-pat "ghp_..." --type service-token --sync  # opt-in to sync
arc secret get anthropic-key
arc secret list                          # shows names, types, profiles — never values
arc secret list --show-values            # requires confirmation, logged to audit
arc secret delete old-key
arc secret rotate anthropic-key          # prompts for new value, updates everywhere

# Sync
arc secret enable-sync                   # set master passphrase
arc secret push                          # encrypt + push opt-in secrets
arc secret pull                          # pull + decrypt on this device
arc secret revoke-device <deviceId>      # revoke a device's access
arc secret export --encrypted            # export encrypted bundle (backup/migrate)
arc secret import <file>                 # import from encrypted bundle
```

### 17.10 Scoped Secret Injection for Agents

Agents need credentials to do real work — API keys for external services, cloud creds for deployments, tokens for git operations. ARC manages this through **scoped injection** with granular policies.

#### The Problem

Today, agents get secrets via ad-hoc env vars (`ANTHROPIC_API_KEY`, `AWS_ACCESS_KEY_ID`). This is:
- All-or-nothing — the agent sees everything or nothing
- No audit trail — no record of which agent used which key
- No scoping — a code review agent gets the same deploy creds as a deploy agent
- No rotation awareness — agents use stale keys until they fail

#### Secret Injection Policies

Each secret can have an injection policy that controls which agents see it:

```typescript
interface SecretInjectionPolicy {
  // What can access this secret?
  allowProfiles: string[];        // profile names (empty = all profiles)
  allowAdapters: string[];        // adapter types (empty = all)
  allowTiers: PermissionTier[];   // coordinator | interactive | worker (empty = all)

  // How is it exposed?
  injection: InjectionMethod;

  // Guardrails
  requireApproval: boolean;       // prompt user before injecting? (default: false for interactive tier)
  maxUsesPerSession: number;      // rate limit (0 = unlimited)
  auditLevel: 'silent' | 'log' | 'notify';  // how loudly to log access
  expiresAt?: string;             // auto-revoke after this date
}

type InjectionMethod =
  | { type: 'env'; varName: string }                    // inject as environment variable
  | { type: 'file'; path: string; format: 'raw' | 'json' | 'dotenv' }  // write to temp file
  | { type: 'mcp'; toolName: string }                   // expose via MCP tool call
  | { type: 'prompt'; template: string }                // inject into agent prompt context
  | { type: 'header'; headerName: string };             // for HTTP-based agents
```

#### Examples

```bash
# API key — available to all Claude Code profiles, injected as env var
arc secret set anthropic-key "sk-ant-..." \
  --type api-key \
  --inject env:ANTHROPIC_API_KEY \
  --allow-adapter claude-code

# Deploy creds — only coordinator tier, requires approval, notify on use
arc secret set aws-prod "AKIA..." \
  --type cloud-credential \
  --inject env:AWS_ACCESS_KEY_ID \
  --allow-tier coordinator \
  --require-approval \
  --audit notify

# GitHub PAT — all profiles, but rate-limited, log access
arc secret set github-pat "ghp_..." \
  --type service-token \
  --inject env:GITHUB_TOKEN \
  --max-uses-per-session 50 \
  --audit log

# Database password — only specific profile, written to temp file (cleaned up on session end)
arc secret set db-password "hunter2" \
  --type passphrase \
  --inject file:/tmp/arc-secrets/db.env:dotenv \
  --allow-profile deploy-agent

# Expose a secret as an MCP tool (agent must explicitly request it)
arc secret set stripe-key "sk_live_..." \
  --type api-key \
  --inject mcp:get_stripe_key \
  --allow-tier interactive \
  --require-approval
```

#### Injection Flow

```
arc launch <profile>
    ↓
[Profile Resolution]
    ↓
[Secret Policy Evaluation]
    ├── Filter secrets by: profile, adapter, tier
    ├── Check: requireApproval → prompt user if needed
    ├── Check: expiresAt → skip if expired
    ├── Check: maxUsesPerSession → track count
    ↓
[Injection by Method]
    ├── env → set in process environment before spawn
    ├── file → write to temp path, add to cleanup list
    ├── mcp → register as MCP tool (agent must call it)
    ├── prompt → append to system prompt / instructions
    ├── header → configure on HTTP adapter
    ↓
[Audit Log]
    ├── secret name, profile, adapter, tier, injection method
    ├── timestamp, session ID
    └── usage count
```

#### Permission Tier Integration

The three-tier permission model gates secret access:

| Tier | Default Secret Access | Can See |
|---|---|---|
| **Coordinator** | All secrets for allowed profiles | Everything, including deploy/cloud creds |
| **Interactive** | Standard secrets, approval-gated for sensitive | API keys, service tokens. Deploy creds require approval. |
| **Worker** | Minimal — only secrets explicitly allowed | Only secrets with `allowTiers: ['worker']`. No cloud/deploy creds by default. |

Dark Factory workers (tier: `worker`) get the **minimum viable secret set** — enough to call APIs and run tools, but no deploy keys, no cloud creds, no admin tokens. The coordinator manages sensitive operations.

#### Secret Lifecycle in Agent Sessions

```
Session Start
    ↓
[Inject allowed secrets per policy]
    ↓
Session Active
    ├── Agent uses secrets via env/file/mcp
    ├── Each use logged (if audit level ≥ log)
    ├── maxUsesPerSession tracked
    ↓
Session End
    ├── Temp files cleaned up
    ├── MCP tools deregistered
    ├── Usage summary written to audit log
    ↓
[Rotation Check]
    └── If secret.rotateAfterDays exceeded → surface reminder in next `arc status`
```

---

## 18. Plugin Registry

ARC as a distribution channel for agent tooling — not just a control plane.

### 18.1 Plugin Architecture

```bash
arc plugin install codex-cc        # install from registry
arc plugin install ./local-plugin  # install from local directory
arc plugin update                  # pull upstream changes
arc plugin list                    # list installed plugins
arc plugin remove <name>           # uninstall
```

Plugins can provide:
- **Adapters** — new runtime support (e.g., Aider, Continue, custom agents)
- **Hooks** — additional supervision hooks
- **Skills** — additional skill definitions (including contract skills)
- **MCP servers** — tool providers
- **Dashboard views** — custom web dashboard panels

### 18.2 Plugin Structure

```
my-arc-plugin/
├── plugin.json              # Manifest (name, version, capabilities, compatibility)
├── adapters/                # Optional: custom adapter(s)
├── hooks/                   # Optional: hook implementations
├── skills/                  # Optional: skill definitions
├── mcp/                     # Optional: MCP server config
└── dashboard/               # Optional: custom dashboard views
```

### 18.3 Registry

- **Curated registry** of community/official plugins (hosted, searchable)
- Profile-scoped activation — some projects get Codex review plugin, others don't
- Upstream tracking — fork with auto-update for official plugins
- Version pinning and compatibility checks against ARC version

### 18.4 Session Continuity / Thread Resume

Named session threads enable cross-session task resumption:

```typescript
interface SessionThread {
  id: string;
  name: string;                  // e.g., "ARC: Implement risk classifier"
  profile: string;
  adapter: string;
  status: 'active' | 'suspended' | 'completed';
  created: string;
  lastActive: string;
  transcript: string;            // path to session transcript
}
```

**Behavior:**
- Sessions are named with a prefix + task excerpt: `"ARC Task: <excerpt>"`
- `arc resume` — list suspended sessions, pick one to continue
- Heuristic follow-up detection: "continue", "keep going", "resume" → offer to resume last thread
- Thread state persisted in SQLite — survives process restarts
- Dark Factory waves use threads for per-task continuity

---

## 19. Web Dashboard

Restructured from Supervisor v1's monolithic `index.html` into a proper frontend.

**Tech:** Express backend + modular frontend (vanilla JS + Chart.js initially, upgradable to Preact/Lit later)

**Views:**

| View | What It Shows |
|---|---|
| **Overview** | Active profiles, running agents, health status across all runtimes |
| **Sessions** | Session list with filters (adapter, profile, time range), drill into any session |
| **Traces** | Full audit trail — every hook result, risk classification, retry decision |
| **Risk** | Risk distribution charts (by tier, adapter, time), keyword hit frequency |
| **Tasks** | Task board — active, assigned, completed, with agent assignment and A2A status |
| **Skills** | Skill registry — built-in, user, generated (skillify), MCP-adapted, success rates |
| **Memory** | Memory explorer — browse by scope/type, relevance scores, aging timeline |
| **Benchmarks** | Pipeline performance, ops/sec, comparison across adapter types |
| **Agents (A2A)** | Registered agent cards, capability matrix, task history |
| **Factory** | Dark Factory runs — wave progress, agent assignments, verify/consensus status |
| **Settings** | Per-profile config editor, hook toggles, enforcement mode |

### 19.1 Semantic Phase Indicators

Context-aware status display for both TUI and web dashboard. Two systems:

**Active phase verbs** — rotating verbs during agent execution, selected based on what the agent is actually doing:
```typescript
type AgentPhase =
  | 'thinking'      // LLM generating
  | 'reading'       // file/resource access
  | 'writing'       // file creation/edit
  | 'executing'     // shell commands
  | 'searching'     // web/file search
  | 'reviewing'     // code review / audit
  | 'planning'      // task decomposition
  | 'delegating'    // spawning sub-agents / sending messages
  | 'verifying'     // running tests / checks
  | 'recovering';   // stuck detection / retry

const phaseVerbs: Record<AgentPhase, string[]> = {
  thinking:   ['Reasoning...', 'Analyzing...', 'Considering...'],
  reading:    ['Reading...', 'Scanning...', 'Loading...'],
  writing:    ['Writing...', 'Creating...', 'Editing...'],
  executing:  ['Running...', 'Executing...', 'Building...'],
  searching:  ['Searching...', 'Looking up...', 'Querying...'],
  reviewing:  ['Reviewing...', 'Checking...', 'Inspecting...'],
  planning:   ['Planning...', 'Breaking down...', 'Organizing...'],
  delegating: ['Delegating...', 'Assigning...', 'Handing off...'],
  verifying:  ['Verifying...', 'Testing...', 'Validating...'],
  recovering: ['Retrying...', 'Recovering...', 'Adjusting...'],
};
```

**Completion verbs** — summary verbs when a turn finishes:
```typescript
const completionVerbs: Record<AgentPhase, string> = {
  reading: 'Read', writing: 'Created', executing: 'Ran',
  searching: 'Found', reviewing: 'Reviewed', verifying: 'Verified',
  // ...
};
```

Phase detection is deterministic — based on which tools are being called (file read → `reading`, bash → `executing`, etc.).

### 19.2 Agent Persona / Buddy System

Optional animated agent avatar that reacts to agent state. Useful for dashboard status feedback and personality differentiation in multi-agent setups.

```typescript
interface AgentPersona {
  name: string;               // display name
  avatar: string;             // emoji, icon URL, or sprite reference
  personality?: string;       // short personality prompt (injected into agent context)
  states: Record<AgentPhase | 'idle' | 'error', PersonaState>;
}

interface PersonaState {
  icon: string;               // state-specific icon/sprite
  animation?: string;         // CSS animation class
  statusText: string;         // what to show in dashboard
}
```

Personas are optional — configured per profile. In the web dashboard, each active agent gets a card with its persona, current phase, and live status. In the TUI, shown as a compact status line per agent.

**Endpoints:**
```
GET  /dashboard                     # Web UI
GET  /api/overview                  # Summary stats
GET  /api/sessions?profile=X        # Session list
GET  /api/traces?session=X&limit=50 # Trace query
GET  /api/risk/distribution         # Risk chart data
GET  /api/benchmarks                # Performance data
GET  /api/agents                    # A2A agent registry
GET  /api/factory/:runId            # Factory run status
POST /api/factory/run               # Start factory run
```

---

## 20. Configuration

### 20.1 Global Config (`~/.arc/config.json`)

```json
{
  "activeProfile": "work-claude",
  "defaultAdapter": "claude-code",
  "defaultEnforcement": "log",
  "telemetry": {
    "enabled": true,
    "otlpEndpoint": null,
    "sqliteEnabled": true,
    "consoleEnabled": false
  },
  "dashboard": {
    "port": 3200,
    "autoOpen": false
  },
  "circuitBreaker": {
    "maxConsecutiveFailures": 3,
    "degradeAction": "log",
    "resetAfterMinutes": 15,
    "serialFallback": true,
    "notifyChannels": []
  },
  "mcpServer": {
    "enabled": true,
    "port": 3201
  },
  "a2a": {
    "enabled": false,
    "port": 3202
  },
  "hooks": {
    "source-classify": {
      "enabled": true,
      "priority": 1,
      "botAccountIds": [],
      "cronPatterns": ["CRON_TRIGGER", "heartbeat"]
    },
    "risk-detection": {
      "enabled": true,
      "priority": 10,
      "keywords": ["rm -rf", "drop table", "delete from", "truncate"],
      "customKeywords": [],
      "blockTier": "destructive"
    }
  },
  "memory": {
    "enabled": true,
    "autoExtract": true,
    "decayThreshold": 0.1,
    "defaultTtlDays": 7,
    "teamMemoryEnabled": false,
    "syncTargets": {
      "obsidian": { "enabled": true, "vaultPath": "/home/bailey/obsidian-vault" }
    }
  },
  "skills": {
    "enabled": true,
    "skillifyEnabled": false,
    "skillifyMode": "suggest",
    "stuckDetection": {
      "enabled": true,
      "maxSimilarAttempts": 3,
      "recoveryStrategies": ["reframe", "escalate"]
    }
  },
  "tasks": {
    "enabled": true,
    "persistToSqlite": true,
    "a2aInterop": false
  },
  "routing": {
    "enabled": true,
    "autoDispatchThreshold": 0.8,
    "suggestThreshold": 0.5
  },
  "context": {
    "autoCompaction": true,
    "compactionTurnThreshold": 12,
    "keepRecentTurns": 4
  },
  "permissions": {
    "defaultTier": "interactive",
    "workerDenyPrefixes": ["rm", "drop", "truncate", "kill"],
    "auditLog": true
  },
  "shared": {
    "enabled": true,
    "syncMcp": true,
    "syncInstructions": true,
    "syncMemory": true
  }
}
```

### 20.2 Per-Profile Config (in `~/.arc/profiles/<name>/`)

```
~/.arc/
├── config.json              # Global config
├── profiles/
│   ├── work-claude/
│   │   ├── profile.json     # Profile definition
│   │   ├── credentials/     # Auth material (keyring-backed)
│   │   └── config/          # Tool-specific config snapshot
│   ├── personal-codex/
│   │   └── ...
│   └── team-gemini/
│       └── ...
├── shared/                  # Shared config layer
│   ├── mcp-servers.json
│   ├── instructions.md
│   └── memory/
├── skills/                  # User + generated skills
│   ├── generated/           # Skillify-created skills
│   └── *.yaml               # User-created skills
├── db/
│   └── arc.sqlite           # Traces, sessions, benchmarks, memories, tasks
├── traces/                  # Debug trace exports
└── factory/                 # Dark Factory run state
```

---

## 21. CLI Commands

### Top-Level

| Command | Description |
|---|---|
| `arc` | Open TUI dashboard |
| `arc launch [profile]` | Launch agent with profile (detect adapter, apply env, start supervision) |
| `arc create <name>` | Create profile |
| `arc use <name>` | Switch active profile |
| `arc list` | List all profiles |
| `arc status` | Multi-runtime status (all profiles, active agents, health) |
| `arc doctor` | Diagnostics (tools, config, hooks, connectivity) |
| `arc dashboard` | Open web dashboard |
| `arc factory run` | Start Dark Factory execution |

### Profile Management

| Command | Description |
|---|---|
| `arc profile create` | Interactive profile creation |
| `arc profile list` | List with status |
| `arc profile show <name>` | Detail view |
| `arc profile switch <name>` | Switch active |
| `arc profile delete <name>` | Remove |
| `arc profile import [name]` | Import from existing tool config |
| `arc profile clone <src> <dst>` | Duplicate a profile |
| `arc profile set-flags <name>` | Set persistent launch flags |

### Supervision

| Command | Description |
|---|---|
| `arc exec <prompt>` | Execute with full supervision pipeline |
| `arc audit <response>` | Manual completion audit |
| `arc expand <prompt>` | Manual intent expansion |
| `arc classify <message>` | Manual risk classification |
| `arc trace [session]` | Query trace history |
| `arc bench` | Run benchmark suite |

### Configuration

| Command | Description |
|---|---|
| `arc config get <key>` | Read config value |
| `arc config set <key> <val>` | Write config value |
| `arc shared status` | Shared layer status |
| `arc shared sync` | Force sync shared layer |
| `arc setup` | Install shims, PATH, shell integration |
| `arc update` | Self-update + refresh shims |
| `arc uninstall` | Remove shell integration |

### Skills

| Command | Description |
|---|---|
| `arc skill list` | List all skills (builtin, user, generated, MCP) |
| `arc skill show <name>` | Show skill details and steps |
| `arc skill create --interactive` | Guided skill creation |
| `arc skill create --from-session <id>` | Generate skill from session transcript (skillify) |
| `arc skill delete <name>` | Remove a skill |
| `arc skill test <name>` | Dry-run a skill |

### Tasks

| Command | Description |
|---|---|
| `arc task create <desc>` | Create a task |
| `arc task list` | List tasks (active, completed, failed) |
| `arc task show <id>` | Task details + output |
| `arc task assign <id> <profile>` | Assign task to an agent profile |
| `arc task cancel <id>` | Cancel a running task |
| `arc task send <profile> <msg>` | Send message to another agent |

### Memory

| Command | Description |
|---|---|
| `arc memory list` | List memories (filterable by scope, type, relevance) |
| `arc memory search <query>` | Relevance search across memories |
| `arc memory add <content>` | Manually add a memory |
| `arc memory prune` | Archive low-relevance memories |
| `arc memory sync` | Force sync to external targets (Obsidian) |
| `arc memory export` | Export memories as JSON |

### Plugins

| Command | Description |
|---|---|
| `arc plugin install <name>` | Install plugin from registry or local path |
| `arc plugin list` | List installed plugins |
| `arc plugin update [name]` | Update plugin(s) from upstream |
| `arc plugin remove <name>` | Uninstall plugin |

### Secrets

| Command | Description |
|---|---|
| `arc secret set <name> <value>` | Store a secret (with --type, --inject, --allow-*, --sync flags) |
| `arc secret get <name>` | Retrieve a secret value |
| `arc secret list` | List secrets (names, types, profiles — never values) |
| `arc secret delete <name>` | Remove a secret |
| `arc secret rotate <name>` | Prompt for new value, update everywhere |
| `arc secret enable-sync` | Set master passphrase, enable encrypted sync |
| `arc secret push` | Encrypt + push opt-in secrets to sync provider |
| `arc secret pull` | Pull + decrypt secrets to this device |
| `arc secret revoke-device <id>` | Revoke a device's access to synced secrets |
| `arc secret export --encrypted` | Export encrypted bundle for backup/migration |

### Sync

| Command | Description |
|---|---|
| `arc login` | Authenticate with sync provider |
| `arc logout` | Clear sync session |
| `arc sync pull` | Pull all data from cloud |
| `arc sync push` | Push local changes to cloud |
| `arc sync status` | Show sync state, last sync, conflicts |
| `arc sync devices` | List registered devices |

### Sessions

| Command | Description |
|---|---|
| `arc resume` | List suspended sessions, pick one to continue |
| `arc jobs list` | List background jobs |
| `arc jobs cancel <id>` | Cancel a running background job |
| `arc jobs output <id>` | View job output |

### Factory

| Command | Description |
|---|---|
| `arc factory run --spec <file>` | Start factory run |
| `arc factory status [runId]` | Check run status |
| `arc factory abort [runId]` | Abort run |
| `arc factory list` | List past runs |

---

## 22. Migration Plan

### From ARC v0.1

- `~/.arc/` directory structure preserved
- Profile format extended (new fields are optional, old profiles work)
- TUI preserved and extended with new views
- CLI commands preserved, new commands added
- `@axiom-labs/arc-cli` npm package continues

### From Axiom-Supervisor

- Core modules (`src/core/*`) move to `packages/core/`
- Adapters (`src/adapters/*`) move to `packages/adapters/`
- Hooks extracted to `packages/hooks/`
- Dashboard moves to `packages/dashboard/` and gets restructured
- Tests migrate with their modules
- `openclaw.plugin.json` updated to reference new package paths
- MCP server moves to `packages/protocols/mcp-server/`
- SQLite schema preserved, extended with profile/adapter columns

### Implementation Phases

> Updated 2026-04-02 per spec review. See DECISIONS.md for full rationale.

| Phase | What | Priority | Notes |
|---|---|---|---|
| **1** | Monorepo setup, migrate core + profiles from both projects | P0 | |
| **2** | Adapter interface + Claude Code adapter (deepest integration) | P0 | |
| **3** | Logging framework + `arc logs` command | P0 | **NEW.** Everything after this needs logging. |
| **4** | Graceful shutdown + health checks | P0 | **NEW.** Process lifecycle before hook pipeline. |
| **5** | Codex + Gemini adapters (process wrappers) | P1 | |
| **6** | OpenClaw adapter (migrate existing plugin) | P1 | |
| **7** | Hook pipeline (migrate from Supervisor, add new hooks + timeouts) | P1 | |
| **8** | MCP dual-role (host + server) | P1 | |
| **9** | Profile inheritance + `arc.json` workspace selection | P1 | Bumped from P2 — needed early. |
| **10** | Secret management (credential store, encryption, injection) | P1 | **NEW.** Secrets are profile-scoped. |
| **11** | Cloud sync (providers, data model, conflict resolution) | P2 | **NEW.** Needs secret store. |
| **12** | Web dashboard restructure (WebSocket real-time) | P2 | |
| **13** | OpenTelemetry integration | P2 | |
| **14** | Circuit breaker | P2 | |
| **15** | Memory system (session/persistent/team, aging, relevance search) | P2 | |
| **16** | Skill system (loader, registry, MCP adapter) | P2 | |
| **17** | Task management (first-class tools, agent messaging) | P2 | |
| **18** | Session continuity (thread resume, background jobs) | P2 | **NEW.** After tasks. |
| **19** | Context management (auto-compaction, token/cost budgets) | P2 | Includes cost budget. |
| **20** | Three-tier permission model | P2 | |
| **21** | Semantic phase indicators | P2 | Personas deferred to v2. |
| **22** | Skillify (self-improving skills) + stuck detector | P3 | |
| **23** | Plugin registry (manifest, install, update, MVP security) | P3 | **NEW.** After skills exist. |
| **24** | Remote agent support | P3 | |
| **25** | Dark Factory mode (in-process state machine) | P3 | |

**Deferred to v2:** A2A protocol, prompt routing, agent personas/buddy system, S3 sync provider.
See `DECISIONS.md` for deferral rationale and v2 trigger conditions.

**Cross-cutting (all phases):** Auth on exposed servers, secret input safety, config/schema versioning, platform compatibility. See `DECISIONS.md § Critical Fixes`.

---

## 23. Tech Stack

| Component | Technology |
|---|---|
| **Language** | TypeScript (strict mode) |
| **Runtime** | Node.js ≥ 20 |
| **Build** | tsup (bundler) |
| **Monorepo** | pnpm workspaces |
| **CLI** | Commander.js v14 |
| **TUI** | Ink v6 (React 19) + @inkjs/ui |
| **Dashboard** | Express + Chart.js (upgrade path: Preact/Lit) |
| **Database** | better-sqlite3 |
| **MCP** | @modelcontextprotocol/sdk |
| **Telemetry** | @opentelemetry/sdk-node |
| **Testing** | Vitest |
| **Auth** | @napi-rs/keyring (OS keyring) |
| **CI** | GitHub Actions (Ubuntu + Windows matrix) |

---

## 24. Key Design Decisions

| Decision | Rationale |
|---|---|
| Absorb Supervisor entirely | Same author, same stack, complementary scopes. Two repos = friction. |
| Monorepo with packages | Keeps it one install but cleanly separable. Adapters are independently publishable. |
| Adapter interface as plugin boundary | New runtimes don't touch core. Claude Code gets deep hooks, others get process wrapping. Same pipeline either way. |
| MCP dual-role | Host for tool access, server for supervision tools. Maximizes interop with minimal protocol overhead. |
| A2A for agent orchestration | Standard protocol for multi-agent coordination. Replaces custom roundtable state machine with task lifecycle. |
| OpenTelemetry over custom traces | Standard observability. Export to any backend. Don't reinvent tracing. |
| Circuit breaker | Prevents audit loop traps (v1's worst bug). Fail open, not closed. |
| Default `log` mode | Learned from Supervisor v1 — `enforce` caused gateway restart storms. Ship safe, opt into strictness. |
| Dark Factory as future phase | Architecture supports it now (waves, verifier, consensus gate), but implementation is post-MVP. |
| Profile inheritance | Reduces config duplication. Base profile with per-use-case overrides. |
| `arc.json` per repo | Zero-friction per-project configuration. `cd into repo → arc launch → correct profile`. |
| Hierarchical memory with aging | Session memory is cheap. Persistent memory decays. Team memory enables multi-agent context sharing. No infinite accumulation. |
| Skills over tools | Tools are atomic operations. Skills are reusable procedures. MCP-to-skill adapter bridges the gap. Skillify makes the system self-improving. |
| Tasks as first-class tools | Not a separate API — agents create/manage tasks with the same tool interface they use for everything else. Maps to A2A task lifecycle. |
| Score-based prompt routing | No explicit command prefixes needed. Deterministic tokenization + scoring. Fast path for obvious matches, confirmation for ambiguous ones. |
| Three-tier permissions | Coordinator > Interactive > Worker. Dark Factory workers get degraded permissions by default. Prevents runaway sub-agents. |
| Stuck detection | Agents that loop get detected and recovered automatically. Better than timeout-based approaches. |
| Semantic phase indicators | Users and dashboards see *what* the agent is doing, not just "processing...". Deterministic phase detection from tool calls. |
| Agent personas | Optional but useful — personality differentiation in multi-agent setups, fun status feedback in dashboard. |
| Context management | Long sessions degrade. Auto-compaction at 12 turns prevents context window overflow. Token budget is a first-class constraint. |
| Local-first with optional sync | CLI tools must work offline. Sync is a bonus. Credentials never leave the device. |
| Three built-in sync providers | Git (portable), filesystem (simple), S3 (cloud-native). No plugins required for basic sync. Covers 90% of setups. |
| Auth is provider-specific | ARC doesn't build auth. Git uses SSH keys, S3 uses access keys, API providers bring their own. Clean separation. |
| SyncProvider as plugin interface | Built-in providers cover most users. Plugin interface enables custom backends (Axiom-Vault, WebDAV, Redis, etc.). |
| Encrypted credential sync | Secrets sync via Argon2id + AES-256-GCM envelope encryption. Per-secret opt-in. Passphrase never stored. Provider-agnostic — encrypted blobs over any backend. |
| Scoped secret injection | Secrets are policy-gated: by profile, adapter, and permission tier. Five injection methods (env, file, MCP tool, prompt, header). Audit trail on every access. Workers get minimum viable secrets. |
| Broker/Pool for process management | Persistent background process for concurrent requests. Fallback to direct spawn. Avoids cold-start latency. |
| ALLOW/BLOCK gate protocol | Simple, structured supervision. First-line parsing is reliable. Only gates substantive work — no overhead on status turns. |
| Plugin registry as distribution | ARC isn't just a tool — it's a platform. Curated plugin registry positions it as the distribution channel for agent tooling. |
| Session continuity / thread resume | Long-running tasks shouldn't die with the process. Named threads + transcript persistence enable cross-session work. |

---

*This spec absorbs and supersedes: ARC v0.1 README/FEATURES.md, Axiom-Supervisor README/SPEC.md/TODO.md.*  
*Incorporates patterns from: claw-code research (hierarchical memory, dream consolidation, skill system, skillify, stuck detection, task tools, three-tier permissions, prompt routing, auto-compaction, spinner verbs, buddy system). Codex Plugin research (broker/pool, ALLOW/BLOCK gate, background jobs, structured review schema, thread resume, inferred completion, skill-as-contract, plugin registry).*  
*Last updated: 2026-04-02 — phases updated, deferrals applied, see DECISIONS.md*
