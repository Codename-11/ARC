# FEATURES.md — ARC Feature Backlog

Tracking file for planned features, enhancements, and ideas. Checked items are shipped. See `docs/expansion-ideas.md` for broader product direction and `docs/spec/SPEC.md` for the full v2.0 spec.

## Priority 1 — Core UX Gaps

- [x] **Profile creation in TUI** — stepped overlay form (name -> tool -> auth type -> done) so users don't have to exit the TUI to create profiles
- [x] **Theme persistence** — save theme choice (`light`/`dark`) to `config.json` so it survives restarts
- [ ] **Actionable Dash view** — Enter on active profile to launch; show `ImportHint` when unimported tools detected
- [ ] **Persist activity to Log view** — write launch/switch/error events to a shared log so the Log view shows real history instead of a placeholder
- [ ] **Surface profile metadata** — show description, launchArgs, envOverrides, and credential expiry in Profiles detail pane

## Priority 2 — Workflow Improvements

- [x] **Workspace-aware profile auto-selection** — `arc.json` in repo root specifies preferred profile/tool; workspace overrides applied on launch (Phase 9)
- [x] **Workspace shell syntax highlighting** — tokenized input with color-coded `/commands` (green), `@profiles` (blue), `#tags` (dimmed); invalid tokens show in red
- [x] **Workspace shell auto-complete** — suggestion overlay for `/` commands and `@profile` mentions; Tab/Enter accepts, arrows navigate, Escape dismisses
- [ ] **Quick profile switch overlay** — global `Ctrl+S` or palette action that shows a focused profile picker from any view
- [x] **Doctor repair actions** — inline install hints, re-auth instructions, and PATH/shell fix hints on actionable diagnostics
- [ ] **Profile search/filter** — `/` search in Profiles view and queue for scaling to 10+ profiles
- [x] **Import/migration wizard in TUI** — auto-detect step in CreateProfileOverlay and OnboardingScreen imports detected tools interactively
- [ ] **Environment preview before launch** — show env vars, config dir, binary path before spawning a profile

## Priority 3 — Architecture & Platform

- [x] **Per-tool shared layer namespaces** — generic `adapterArtifacts` replaces tool-specific fields; adapters declare capabilities (Phase 5-6)
- [x] **Tool-adapter architecture** — `RuntimeAdapter` interface with lifecycle methods; Claude, Codex, Gemini, OpenClaw, and Generic adapters (Phase 2, 5-6)
- [x] **Profile inheritance** — `inherits` field + `resolveProfile()` engine for base + override resolution (Phase 9)
- [x] **Project-local config** (`arc.json`) — preferred tool, profile, workspace overrides per repo (Phase 9)
- [ ] **Team/shared config** — repo-checked config with local secret overlays
- [ ] **Backup/export/import** — move profiles and settings between machines
- [x] **Managed updates** — self-update system with npm registry check and TUI update banner

## Priority 4 — Observability & Polish

- [ ] **Launch history on Dash** — recent launches list (`{ profile, tool, timestamp }`) in `~/.arc/history.json`, displayed on Dash after first session
- [x] **Shared layer visibility** — SettingsView shows per-profile sync details; ProfileList shows shared indicator column
- [ ] **Toast notifications** — brief auto-dismiss messages for confirmations/errors that work across all views
- [ ] **Interactive sidebar queue** — Enter on sidebar profile list to quick-launch without switching views
- [x] **MCP server management** — MCP host manager with connect/disconnect/list/getTools + callTool with risk classification (Phase 8)
- [x] **Policy layer** — three-tier permission model (coordinator/interactive/worker) with deny > ask > allow precedence (Phase 20)
- [ ] **Profile cloning/duplication** — create a new profile from an existing one as template
- [x] **Usage/audit log** — structured JSONL log with `arc logs` CLI, level/component/profile filtering (Phase 3)

## v2.0 Spec Features (All 25 Phases Complete)

### Monorepo & Adapters (Phases 1-2, 5-6)
- [x] Monorepo conversion: `packages/core`, `cli`, `mcp`, `adapter-claude`, `adapter-openclaw`, `dashboard`
- [x] `RuntimeAdapter` interface with launch/terminate/isRunning lifecycle
- [x] Claude Code adapter (SDK bridge, auth, detect, import, shared)
- [x] Codex CLI adapter (cross-platform process management, real spawn/terminate)
- [x] Gemini CLI adapter (real lifecycle wired)
- [x] OpenClaw adapter (plugin manifest, RuntimeAdapter, 3 lifecycle hooks)
- [x] Hermes Agent adapter (MCP bridge, lifecycle, process management)
- [x] Generic adapter factory (fallback for any unknown tool, health monitoring)
- [x] 48 adapter registry + generic adapter tests

### Logging & Lifecycle (Phases 3-4)
- [x] Structured JSONL log at `~/.arc/logs/structured.jsonl`
- [x] `arc logs` CLI command with `--limit`, `--level`, `--component`, `--profile`, `--json`
- [x] Graceful shutdown: signal forwarding, cleanup, exit code normalization
- [x] Health check types + `buildHealthReport()`

### Hook Pipeline (Phase 7)
- [x] Hook type system + HookBus pipeline runner with 4-mode enforcement (log/warn/enforce/off)
- [x] Source-classify hook (priority 1) + risk-classifier pure function
- [x] Interagent-routing hook factory (priority 2) — bot→bot loop suppression with @mention override, roundtable-aware
- [x] Attempt-tracker factory (session + turn scoped retry counting)
- [x] Roundtable hook factory (priority 50) — multi-agent discussion orchestration with turn management, mode assignment, synthesis lifecycle
- [x] `auditCompletion()` pure function (status x confidence -> recommendation)
- [x] `runWithRetry()` enforce-mode retry loop + `createDefaultPipeline`
- [x] Supervision-gate hook factory (ALLOW/BLOCK parsing)
- [x] Post-verify hook factory (pluggable health polling, exponential backoff)

### MCP Dual-Role (Phase 8)
- [x] `@axiom-labs/arc-mcp` package with 5 supervision tools
- [x] `arc mcp serve` CLI with stdio transport (31 integration tests)
- [x] HTTP server transport with per-session auth
- [x] McpHostManager: connect/disconnect/list/getTools + callTool with risk classification
- [x] `arc mcp connect/list/disconnect` CLI commands

### Profile Inheritance & Workspace (Phase 9)
- [x] `inherits` field on Profile type
- [x] `resolveProfile()` engine for base + override resolution
- [x] `loadWorkspaceConfig()` + `applyWorkspaceOverrides()` for `arc.json`
- [x] `arc which` command showing resolved profile source

### Secret Management (Phase 10)
- [x] Encrypted secret store: Argon2id KDF, AES-256-GCM per-entry encryption
- [x] `arc secret` command group: set/get/list/delete

### Cloud Sync (Phase 11)
- [x] `SyncProvider` interface + filesystem sync provider
- [x] `SyncManager` with cursor tracking and status
- [x] Atomic writes, mtime change detection

### Web Dashboard (Phase 12)
- [x] `packages/dashboard/` with raw `node:http` server
- [x] 10 REST API endpoints (overview, sessions, traces, risk, tasks, skills, memory, agents, factory, health)
- [x] WebSocket server (RFC 6455) for real-time event push
- [x] SPA frontend: 9 modular view components, dark/light toggle
- [x] Nothing-inspired design: Doto/Space Grotesk/Space Mono typography

### OpenTelemetry (Phase 13)
- [x] `TelemetryProvider` with span lifecycle, trace IDs, sample rate
- [x] Console, JSONL, and OTLP exporters
- [x] All spans use `arc.*` attribute namespace

### Circuit Breaker (Phase 14)
- [x] Consecutive failure tracking, auto-trip at threshold
- [x] `getEffectiveEnforcement()` degrades to log when tripped
- [x] Auto-reset after configurable cooldown

### Memory System (Phase 15)
- [x] Session + persistent memory backends
- [x] Exponential decay scoring with half-life + access boost
- [x] Keyword/scope/type/recency search ranking
- [x] Heuristic memory extraction (corrections, preferences, patterns, decisions)

### Skill System (Phase 16)
- [x] Skill/SkillStep/ContractSkill types + SkillRegistry
- [x] Directory-based JSON skill file loader
- [x] `mcpToSkill()` — MCP tool to skill adapter

### Task Management (Phase 17)
- [x] TaskStore (JSON file-backed CRUD)
- [x] MessageBus (in-memory agent-to-agent routing)
- [x] TaskDelegator — agent-to-agent delegation (delegate/accept/complete/fail/requestInput/provideInput), self-delegation guard, listener TTL cleanup
- [x] Status transition validation (created → assigned → working → completed/failed, input-required ↔ working)
- [x] CronStore with 5-field cron expression parser

### Session Continuity (Phase 18)
- [x] SessionStore with create/suspend/resume/complete lifecycle
- [x] `isResumeIntent()` heuristic detection

### Context Management (Phase 19)
- [x] Turn tracking, token budget, compaction trigger
- [x] `compact(summarizer)` for old turn summarization

### Three-Tier Permissions (Phase 20)
- [x] Coordinator/interactive/worker defaults
- [x] Deny > ask > allow precedence with audit logging
- [x] Worker tier blocks destructive ops

### Semantic Phase Indicators (Phase 21)
- [x] `detectPhase(toolName)` — deterministic tool -> phase mapping
- [x] `StreamEventBus` — typed event emitter for 10 stream event types

### Skillify + Stuck Detector (Phase 22)
- [x] Repeated pattern detection (sliding window)
- [x] Auto-generate skill definitions from patterns
- [x] StuckDetector with Jaccard similarity, cycling recovery strategies

### Plugin Registry (Phase 23)
- [x] JSON-backed plugin registry with install/uninstall/enable/disable
- [x] Semver compatibility checks, capability declarations

### Remote Agent Support (Phase 24)
- [x] Remote agent registry with HTTP health checks
- [x] HTTP/SSH/MCP transport support

### Dark Factory Mode (Phase 25)
- [x] State machine (idle -> planning -> executing -> verifying -> gating -> completed)
- [x] FactorySpec with waves, tasks, consensus gate config
- [x] Wave progression with result tracking

## Deferred to v2

- A2A protocol implementation (agent cards, task lifecycle over HTTP)
- Roundtable via A2A (replace hook state machine with A2A task lifecycle)
- Prompt routing (score-based intent dispatch)
- Agent personas / buddy system
- S3 sync provider

## Completed (v0.1.0)

- [x] TUI dashboard with Ink (sidebar, views, command palette, overlays)
- [x] Multi-tool support (Claude, Gemini, Codex) with auth adapters
- [x] Shared layer sync (MCP servers, commands, CLAUDE.md, memory, projects)
- [x] Shell integration (bash, zsh, fish, PowerShell)
- [x] Doctor diagnostics (config, PATH, shell, binaries, credentials)
- [x] Credential checking with expiry tracking
- [x] Photon/Carbon Night theme system with toggle
- [x] Dash view with ASCII logo and status overview
- [x] Ctrl-modified hotkeys to avoid typing conflicts
- [x] Mouse scroll capture in fullscreen TUI
- [x] Log view placeholder
- [x] Command palette and help overlay
- [x] Fullscreen TUI onboarding wizard (OnboardingScreen) with auto-detect + stepped creation
- [x] Doctor repair actions (install hints, re-auth instructions, PATH/shell fix hints)
- [x] Auto-detect import in CreateProfileOverlay and OnboardingScreen
- [x] Shared layer sync status in SettingsView and ProfileList
- [x] GitHub repo link on DashView and HelpOverlay
- [x] Help overlay overhaul (global, sidebar, workspace, profiles sections)

## Infra / Chores

- [x] E2E + integration testing (vitest, ink-testing-library) — CLI spawn tests, TUI smoke + interactive flow tests, profile CRUD, shared layer sync
- [x] CI: run `pnpm typecheck`, `pnpm build`, and `pnpm test` on PRs (ubuntu + windows matrix)
- [ ] Add `.github/dependabot.yml` for automated dependency updates

## Remaining UX Backlog

These items from the original v0.1 backlog are still open:

- [ ] Actionable Dash view (launch on Enter, ImportHint)
- [ ] Persist activity to Log view
- [ ] Surface profile metadata in detail pane
- [ ] Quick profile switch overlay (Ctrl+S)
- [ ] Profile search/filter in Profiles view
- [ ] Environment preview before launch
- [ ] Team/shared config (repo-checked config with local secret overlays)
- [ ] Backup/export/import (move profiles between machines)
- [ ] Launch history on Dash
- [ ] Toast notifications
- [ ] Interactive sidebar queue
- [ ] Profile cloning/duplication
