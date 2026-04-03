# ARC — Spec Decisions & Implementation Guide
> Finalized: 2026-04-02
> 
> This document captures all reviewed decisions against SPEC.md v2.0.
> Read this before SPEC.md — it tells you what to build, what to skip, and what changed.

---

## How to Use This Document

**If you're an agent starting implementation:**
1. Read SPEC.md for the full technical spec
2. Read this file for what's approved, deferred, and modified
3. Read `docs/supervisor-patterns.md` for inherited patterns from Axiom-Supervisor
4. Follow the Implementation Phases in SPEC.md (updated with this review's changes)

---

## Critical Fixes (Apply to All Phases)

These are cross-cutting concerns. Every phase must account for them.

### 1. Auth on Exposed Servers
All HTTP surfaces (Dashboard, MCP server, A2A endpoints) MUST:
- Bind to `localhost` by default
- Require bearer token / shared secret for non-localhost access
- Document auth setup clearly — make it easy to configure, not just secure
- Apply to: §8 (Protocol Integration), §19 (Web Dashboard)

### 2. Secret Input Safety
`arc secret set` MUST NOT expose values in shell history or `ps`:
- `--from-stdin` — pipe from another command
- `--from-file <path>` — read from file
- Interactive prompt (default) — masked input when no flag given
- All three methods, interactive is the default
- Apply to: §17.9 (Credential & Secret Sync), §21 (CLI Commands)

### 3. Graceful Shutdown
Define SIGINT/SIGTERM handlers. On shutdown:
- Flush all OTel traces
- Clean up temp secret files
- Terminate child processes (adapters)
- Close database connections
- Release file locks
- Apply to: §4 (Process Management), §9 (Circuit Breaker), §10 (OTel)

### 4. Config/Schema Versioning
Add `"version": 1` to all persistent formats:
- `~/.arc/config.json`
- `~/.arc/profiles/<name>/profile.json`
- `skill.yaml` files
- `arc.json` per-repo files
- Implement version check on load with migration path
- Apply to: §7 (Profile System), §13 (Skill System), §17 (Cloud Sync), §20 (Configuration)

---

## Significant Gaps (Integrate Into Spec)

### Hook Timeouts
Add configurable timeout per hook (default: 5s). If a hook exceeds timeout:
- `log` mode: warn and continue
- `warn` mode: warn and continue
- `enforce` mode: fail the pipeline
- `audit` mode: record timeout in trace
Apply to: §6 (Hook System)

### Logging Framework
Define before implementation begins:
- Levels: `debug`, `info`, `warn`, `error`
- Format: structured JSON (machine) + human-readable (TTY)
- Destination: stderr for CLI, file rotation for persistent logs (`~/.arc/logs/`)
- Integration: OTel spans are separate from operational logs
- Apply to: new §X (see phase table), referenced by all sections

### `arc logs` Command
```
arc logs                    # tail recent logs
arc logs --level error      # filter by level
arc logs --adapter claude   # filter by adapter
arc logs --session <id>     # filter by session
arc logs --follow           # stream live
arc logs --json             # machine-readable output
```
Apply to: §21 (CLI Commands)

### Section Reorganization
These are misplaced in the current spec — promote to top-level sections:
- **Session Continuity** — currently §18.4 under Plugin Registry → should be its own section
- **Three-Tier Permission Model** — currently §16.3 under Context Management → should be its own section
- **Semantic Phase Indicators** — currently §19.1 under Dashboard → should be its own section (Dashboard consumes it, but it's a core concept)

### Cost/Token Budget
Add to Context Management (§16):
- Per-session token budget (configurable)
- Per-session cost limit (requires adapter-reported pricing)
- Warning at 80% budget, hard stop at 100%
- `arc status` shows current session spend
- Budget inheritable from profile

### Unspecified Package Features
These appear in the package structure but have no spec. Define or remove:
- **Hot-swap** — live adapter switching without restart. Define events, state transfer, or remove.
- **Heuristics** — inherited from Supervisor. See `docs/supervisor-patterns.md` for full definition.
- **Intent expansion** — inherited from Supervisor. See `docs/supervisor-patterns.md`.
- **Completion checklist** — inherited from Supervisor. See `docs/supervisor-patterns.md`.
- **Event bus** — see "Event Bus" in Under-Specified Resolutions below.

### Platform Differences
Add a platform compatibility section:
- Windows: `%APPDATA%\arc\` vs `~/.arc/`, named pipes vs Unix sockets
- Temp files: `os.tmpdir()` not hardcoded paths
- Process groups: `process.kill(-pid)` doesn't work on Windows → use `taskkill`
- Path separators: use `path.join()` everywhere
- CI matrix: Ubuntu + Windows (already in tech stack)

---

## UX Decisions

### CLI Output Modes
All commands support:
- `--json` — machine-readable JSON output
- `--quiet` — suppress non-essential output
- `--verbose` — debug-level detail
Standard across every command. No exceptions.

### Short Aliases
Register in Commander.js:
```
arc l  → arc launch
arc s  → arc status
arc d  → arc doctor
arc w  → arc which
arc p  → arc profile
```

### Shell Completions
Ship completions for bash, zsh, fish, PowerShell. Generate via Commander.js built-in or `tabtab`.

### New Commands
```
arc which          # show resolved profile + adapter for cwd
arc diff           # preview what sync would change
arc quickstart     # detect tools → create profile → launch (< 30s)
arc logs           # operational log viewer (see above)
arc alerts         # view notification history
```

### Command Canonicalization
- `arc profile create` is canonical for profile creation
- Top-level `arc` namespace reserved for primary operations (launch, status, doctor, which, diff, quickstart)
- Subcommands for domain operations (profile, secret, skill, task, sync, factory)

### Confirmation Prompts
Destructive operations require confirmation:
- `arc profile delete`, `arc secret delete`, `arc sync push --force`
- Skip with `--force` or `-y`
- CI environments auto-detect and require `--force` (no interactive prompt)

### Dashboard Real-Time
WebSocket for bidirectional communication:
- Server → client: status updates, trace streaming, alerts, phase changes
- Client → server: launch agents, approve hooks, manage tasks
- Auto-reconnect with exponential backoff

### TUI Views
Add views for: Tasks, Memory, Skills, Factory. Currently web-only — bring to TUI for quick ops consistency.

### Notification System (Layered)
- **Log** — always. Every alert written to `~/.arc/logs/alerts.log`
- **TUI/Dashboard toast** — when active session is open
- **Desktop notification** — for 🔴 severity (circuit breaker trips, destructive ops blocked)
- **Webhook** — opt-in, configurable endpoint for automation (Discord, Slack, etc.)
Configure in `~/.arc/config.json` under `notifications` key.

---

## Deferred to v2

These are architecturally supported but NOT built in v1. Keep the interfaces, skip the implementation.

| Feature | Reason | v2 Trigger |
|---|---|---|
| **A2A protocol** (§8.2) | Most v1 users run 1-2 local agents | When users request cross-host agent coordination |
| **Prompt routing** (§15) | Risk of wrong auto-dispatch, profiles already solve this | Ship behind flag when accuracy data exists |
| **Agent personas / buddy system** (§19.2) | Fun but non-essential | After dashboard and TUI are stable |
| **S3 sync provider** (§17.4) | Git + filesystem cover 90% of setups | When demanded by cloud-native users |

### Secret Injection — Full Security with Bypass
All 5 injection methods ship in v1 (env, file, MCP tool, prompt, header), but:
- `prompt` and `header` injection display a warning on first use
- Power users can suppress with `--i-know-what-im-doing` or config flag
- This preserves security posture while not blocking advanced use cases

---

## Under-Specified Resolutions

### Generic Adapter → MVP (Defer Deep Supervision)
Ship as minimal process wrapper:
- Process spawn + health check + stdout/stderr capture + exit handling
- No hook introspection (can't see what the agent is doing internally)
- Hooks that fire: `pre-launch`, `post-exit`, `health-check` only
- If the agent speaks MCP, upgrade path to MCP-aware adapter
- Community adapters extend `GenericAdapter` for deeper integration
- Full generic supervision (sidecar injection, structured log parsing) is v2

### Plugin Security → MVP Manifest Model
- Plugins declare capabilities in manifest: `filesystem`, `network`, `secrets`, `process`
- ARC warns on install if capabilities are broad ("This plugin requests filesystem + network access")
- No auto-update without confirmation. Pin versions in lockfile.
- Curated registry with review process (npm model)
- No sandboxing in v1 — security theater for Node.js in-process plugins
- v2: signature verification, capability enforcement, optional isolation

### Event Bus → Typed EventEmitter
Define a typed event catalog:
```typescript
type ArcEvent =
  | { type: 'agent.started'; adapterId: string; profileId: string }
  | { type: 'agent.stopped'; adapterId: string; reason: string }
  | { type: 'hook.fired'; hookId: string; result: HookResult }
  | { type: 'hook.timeout'; hookId: string; elapsed: number }
  | { type: 'task.created'; taskId: string }
  | { type: 'task.completed'; taskId: string; status: string }
  | { type: 'circuit.tripped'; adapterId: string; failures: number }
  | { type: 'circuit.recovered'; adapterId: string }
  | { type: 'session.budget.warning'; sessionId: string; percent: number }
  | { type: 'session.budget.exceeded'; sessionId: string }
  | { type: 'factory.stage.changed'; stage: string; taskId: string }
  | { type: 'sync.started'; provider: string }
  | { type: 'sync.completed'; provider: string; conflicts: number }
  | { type: 'notification.alert'; severity: string; message: string };
```
- Internal: Node.js `EventEmitter` with typed events
- Plugin API: `arc.on('agent.started', handler)` subscription interface
- Dashboard bridge: WebSocket relays events to connected clients
- OTel integration: spans are *consumers* of events, not the event system itself
- Reference: Claude Code's internal event patterns in `docs/supervisor-patterns.md`

### Dark Factory IPC → In-Process State Machine
v1 implementation:
- In-process orchestration (not separate processes)
- State machine with typed transitions: `planning → executing → verifying → [complete | retry | escalate]`
- Shared context object passed through pipeline (task brief, artifacts, results)
- OTel span per stage for observability
- On verifier reject: retry same executor (max 3), then escalate to planner
- On planner failure: surface to user with full trace
- Separate processes (different adapters/isolation) is v2
- Reference: Supervisor's audit/retry patterns in `docs/supervisor-patterns.md`

---

## Updated Implementation Phases

Phases renumbered with new additions and deferrals applied.

| Phase | What | Priority | Notes |
|---|---|---|---|
| **1** | Monorepo setup, migrate core + profiles from both projects | P0 | |
| **2** | Adapter interface + Claude Code adapter (deepest integration) | P0 | |
| **3** | **Logging framework + `arc logs`** | **P0** | **NEW.** Everything after this needs logging. |
| **4** | **Graceful shutdown + health checks** | **P0** | **NEW.** Process lifecycle before hook pipeline. |
| **5** | Codex + Gemini adapters (process wrappers) | P1 | Was Phase 3 |
| **6** | OpenClaw adapter (migrate existing plugin) | P1 | Was Phase 4 |
| **7** | Hook pipeline (migrate from Supervisor, add new hooks) | P1 | Was Phase 5. Include hook timeouts. |
| **8** | MCP dual-role (host + server) | P1 | Was Phase 6 |
| **9** | Profile inheritance + `arc.json` workspace selection | P1 | Was Phase 7. Bumped to P1 — needed early. |
| **10** | **Secret management (credential store, encryption, injection)** | **P1** | **NEW.** After profiles (secrets are profile-scoped). |
| **11** | **Cloud sync (providers, data model, conflict resolution)** | **P2** | **NEW.** Needs secret store for encrypted credential sync. |
| **12** | Web dashboard restructure | P2 | Was Phase 8. WebSocket real-time. |
| **13** | OpenTelemetry integration | P2 | Was Phase 10 |
| **14** | Circuit breaker | P2 | Was Phase 11 |
| **15** | Memory system (session/persistent/team, aging, relevance search) | P2 | Was Phase 12 |
| **16** | Skill system (loader, registry, MCP adapter) | P2 | Was Phase 13 |
| **17** | Task management (first-class tools, agent messaging) | P2 | Was Phase 14 |
| **18** | **Session continuity (thread resume, background jobs)** | **P2** | **NEW.** After tasks — thread resume depends on task system. |
| **19** | Context management (auto-compaction, token budgets) | P2 | Was Phase 16. Includes cost/token budget. |
| **20** | Three-tier permission model | P2 | Was Phase 17 |
| **21** | Semantic phase indicators | P2 | Was Phase 18. Personas deferred to v2. |
| **22** | Skillify (self-improving skills) + stuck detector | P3 | Was Phase 19 |
| **23** | **Plugin registry (manifest, install, update, security)** | **P3** | **NEW.** After skills exist to distribute. MVP security model. |
| **24** | Remote agent support | P3 | Was Phase 20 |
| **25** | Dark Factory mode | P3 | Was Phase 21. In-process state machine. |
| ~~--~~ | ~~A2A protocol integration~~ | ~~v2~~ | **DEFERRED.** Architecture supports it. |
| ~~--~~ | ~~Prompt routing (score-based dispatch)~~ | ~~v2~~ | **DEFERRED.** Profiles cover v1 use case. |
| ~~--~~ | ~~Agent personas / buddy system~~ | ~~v2~~ | **DEFERRED.** Non-essential for v1. |
| ~~--~~ | ~~S3 sync provider~~ | ~~v2~~ | **DEFERRED.** Plugin interface ships; S3 impl when demanded. |

**Summary: 25 active phases (3 P0, 5 P1, 10 P2, 3 P3) + 4 deferred to v2.**

---

## Inherited from Axiom-Supervisor

ARC absorbs Axiom-Supervisor entirely. Key patterns preserved in `docs/supervisor-patterns.md`:

- **5-tier risk classification** — read-only → file-modification → build-affecting → deploy-affecting → destructive
- **Deterministic-first philosophy** — entire core runs without LLM, only `expandIntent()` optionally uses one
- **Audit/recommendation logic** — status × confidence matrix → complete/continue/retry/escalate
- **Scope tracking** — predicted vs actual files/surfaces, creep severity scoring
- **Self-retry protocol** — autonomous retry loop (max 3), never ask user "should I continue?"
- **Adapter patterns** — Claude hooks (SDK), Codex sidecar (file protocol), OpenClaw plugin (lifecycle hooks), Generic HTTP, MCP server
- **Session degradation tracking** — per-session state, bloat/stale thresholds
- **212 unit tests + 480 e2e scenarios** — test corpus to migrate

---

*This document supersedes the Obsidian review note. Source: SPEC-REVIEW.md analysis + operator decisions (2026-04-02).*
