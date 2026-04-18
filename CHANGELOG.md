# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-04-18

### Added

- **`arc chat` CLI** — interactive REPL with streaming responses, tool use, and permission modes (`read-only` / `supervised` / `autonomous`). REPL slash commands: `/exit`, `/save`, `/new`, `/mode`, `/clear`, `/sessions`, `/resume`, `/help`. One-shot mode via `--once "<prompt>"`.
- **`ChatSession` per-profile persistence** — sessions stored at `~/.arc/profiles/<name>/chat-sessions/<id>.json` with atomic writes; `--session <id>` / `/resume <id>` to pick up where you left off.
- **Roundtable orchestrator** — `RoundtableOrchestrator` class drives the existing roundtable hook over multiple profiles with adaptive delivery pacing (EMA latency) and a designated synthesizer returning a consensus score. Ported from Agent-Forge.
- **Staged workflow state machine** — `StagedWorkflowManager` implements PLAN → EXEC → VERIFY with per-phase completion patterns and timeouts.
- **Agent stall watchdog** — `AgentWatchdog` nudges agents at 3 min, marks them stalled at 5 min, and runs a decision protocol (ported from Agent-Forge).
- **Agent client abstraction** — `packages/core/src/agent-client/` one-shot CLI invocation for Claude / Codex / Gemini with MCP config injection per `mcpMode` variant and per-tool stream parsers.
- **Tool registry + agent loop** — `packages/core/src/agent/` with three permission modes and ~16 ARC tools (11 read, 4 write, 1 dangerous) wired to existing handlers.
- **Knowledge endowment** — `packages/core/src/knowledge/` with static ARC catalog (architecture + 52-entry command reference + 16-term glossary), 33-entry feature index, and `buildSystemPrompt()` runtime composer under 4K tokens (~1.3K typical).
- **Launch modes** — `launchMode: "native" | "worker"` field on Profile (default `native`). `--native` / `--worker` CLI overrides. TUI `m` key in ProfilesView toggles. Doctor check for deprecated `CLAUDE_CODE_NO_FLICKER` env var.
- **Bare launch** — `arc run <tool>` and `arc launch --bare <tool>` skip the ARC overlay entirely (no env injection, no hook pipeline). Tool-name inference falls through to bare when no matching profile exists.
- **Clearable active profile** — `arc profile switch none` and `arc profile clear-active` set `activeProfile` to `null`. Rendered as `(none)` in CLI and TUI.
- **Agent instructions** — `instructions` / `instructionsFile` fields on Profile, injected as `ARC_AGENT_INSTRUCTIONS` env var at launch. `arc instructions` CLI: `show` / `set` / `edit` / `clear`.
- **OpenAI-compatible providers** — `openai-compat` auth type + `ProviderConfig` (`baseUrl`, `model`, `apiKeyEnvVar`, `displayName`) on Profile; 7 presets (OpenRouter, Ollama, LM Studio, Together, Groq, MiniMax, DeepSeek). `arc provider` CLI: `set` / `show` / `clear` / `presets`.
- **Backup / export / import** — `arc backup create/restore/list` for a gzipped `~/.arc/` archive (credentials excluded by default); `arc profile export` / `arc profile import-file` for single-profile transport with inlined instructions.
- **Profile cloning** — `cloneProfile()` core function + `arc profile clone <src> <dst> [--no-copy-dir]` CLI + `Shift+C` inline clone in ProfilesView.
- **Launch history** — `~/.arc/history.json` records each launch (profile, tool, timestamp, outcome, exitCode); DashView shows recent launches + activity log entries.
- **Toast notifications** — `ToastProvider` + `useToast()` with auto-dismiss (2.5 s); mounted globally in the Dashboard.
- **Interactive sidebar queue** — Enter on a profile row in the Sidebar quick-launches without switching views.

### Documentation

- `user-docs/guide/chat.md` — Chat Guide (quickstart, permission modes, REPL commands, session persistence, known limitations).
- `user-docs/guide/roundtable.md` — Running Roundtables (concepts, programmatic API, adaptive pacing, worker-mode requirement).
- `user-docs/guide/multi-agent-pipelines.md` — PLAN → EXEC → VERIFY state machine with completion patterns and timeouts.
- `user-docs/architecture/index.md` — extended "Agent Client + Chat + Orchestration" section.

### Coming in 0.4.x / 0.5.x

- `arc roundtable` CLI with streaming transcript and per-agent color coding (Phase 6).
- MCP tools: `arc_chat`, `arc_roundtable`, and the 6-tool `team_*` contract (Phase 6).
- Dashboard chat view with per-session WebSocket streaming and tool-call visualization (Phase 7).
- Dashboard roundtable + pipelines views (Phase 8).

## [0.2.0] - 2026-04-03

All 25 phases of the [v2.0 spec](./docs/spec/SPEC.md) are now implemented. ARC has evolved from a profile manager into a unified agent runtime control plane, absorbing the [Axiom-Supervisor](https://github.com/Codename-11/axiom-supervisor) project.

### Added

#### Monorepo & Adapters (Phases 1-2, 5-6)
- **Monorepo conversion** — workspace packages: `packages/core/`, `packages/cli/`, `packages/mcp/`, `packages/adapter-claude/`, `packages/adapter-openclaw/`, `packages/dashboard/`
- **RuntimeAdapter interface** — formal adapter architecture with launch/terminate/isRunning lifecycle methods
- **Claude Code adapter** — `packages/adapter-claude/` with SDK bridge, auth, detect, import, shared layer integration
- **Codex CLI adapter** — cross-platform process management with real spawn/terminate
- **Gemini CLI adapter** — real lifecycle (launch/terminate/isRunning) wired
- **OpenClaw adapter** — `packages/adapter-openclaw/` with plugin manifest, RuntimeAdapter, 3 lifecycle hooks
- **Generic adapter support** — fallback for MCP server or HTTP-based agents
- **Adapter registry** — 27 characterization tests, `handleLaunch` wired to adapter lifecycle with `spawnSync` fallback
- **Spec-aligned capabilities** — all adapters declare capabilities; `PullResult.claudeMd` replaced with generic `adapterArtifacts`

#### Logging & Lifecycle (Phases 3-4)
- **Structured logging** — JSONL log at `~/.arc/logs/structured.jsonl` with `writeLogEvent()`, `logAction()`, `queryLogEvents()`
- **`arc logs` command** — `--limit`, `--level`, `--component`, `--profile`, `--json` flags
- **Graceful shutdown** — `runCommandWithLifecycle()` with signal forwarding (SIGINT/SIGTERM/SIGHUP), cleanup, exit code normalization
- **Lifecycle scope** — `withLifecycleScope()` registerCleanup/runCleanups pattern with signal handlers
- **Health checks** — health check types + `buildHealthReport()` in `core/health.ts`

#### Hook Pipeline (Phase 7)
- **Hook type system** — HookBus pipeline runner with 4-mode enforcement (log/warn/enforce/off)
- **Source-classify hook** — priority 1 hook + risk-classifier pure function
- **Attempt tracker** — session + turn scoped retry counting factory
- **Completion auditor** — `auditCompletion()` pure function (status x confidence -> recommendation)
- **Retry loop** — `runWithRetry()` enforce-mode retry loop + `createDefaultPipeline`
- **Supervision gate** — hook factory with ALLOW/BLOCK parsing
- **Post-verify hook** — pluggable health polling with exponential backoff

#### MCP Dual-Role (Phase 8)
- **`@axiom-labs/arc-mcp` package** — 5 MCP supervision tools (expand-intent, classify-risk, derive-completion, audit-completion, explain-trace)
- **`arc mcp serve`** — stdio transport (31 integration tests)
- **HTTP transport** — `startHttpServer()` with per-session auth, `--transport http/--port/--auth-token/--require-auth` flags
- **MCP host manager** — connect/disconnect/list/getTools + `callTool()` with risk classification
- **`arc mcp connect/list/disconnect`** — CLI commands wired to profiles

#### Profile Inheritance & Workspace (Phase 9)
- **Profile inheritance** — `inherits` field on Profile type, `resolveProfile()` engine for base + override resolution
- **Workspace config** — `loadWorkspaceConfig()` + `applyWorkspaceOverrides()` for `arc.json` per-repo overrides
- **`arc which`** — command showing resolved profile source, inheritance chain, workspace overrides
- **Effective profile resolution** — wired into launch, exec, shell, and MCP commands

#### Secret Management (Phase 10)
- **Encrypted secret store** — Argon2id KDF, AES-256-GCM per-entry encryption
- **`arc secret`** — set/get/list/delete command group integrated into profile resolution

#### Cloud Sync (Phase 11)
- **SyncProvider interface** — `SyncConfig`, `SyncDelta`, `SyncChange` types
- **Filesystem sync provider** — shared directory sync with atomic writes, mtime change detection
- **SyncManager** — wraps any provider with cursor tracking and status

#### Web Dashboard (Phase 12)
- **`packages/dashboard/`** — raw `node:http` server (no Express dependency)
- **10 REST API endpoints** — overview, sessions, traces, risk, tasks, skills, memory, agents, factory, health
- **WebSocket server** — RFC 6455 for real-time event push
- **SPA frontend** — 9 modular view components (overview, sessions, traces, risk, tasks, skills, memory, agents, factory)
- **Nothing-inspired design** — Doto/Space Grotesk/Space Mono typography, OLED dark + warm light themes
- **UI features** — segmented progress bars, stat rows, tag system, phase indicators, SPA router, API client, WS auto-reconnect, dark/light toggle

#### OpenTelemetry (Phase 13)
- **TelemetryProvider** — span lifecycle, trace IDs, sample rate, exporter dispatch
- **Span helpers** — session, preflight, hook, agent execution, tool use, postflight, circuit breaker spans
- **Exporters** — `ConsoleExporter`, `JsonFileExporter` (JSONL at `~/.arc/traces/`), `OtlpExporter` (stub)
- **`arc.*` attribute namespace** — all spans use spec-aligned attributes

#### Circuit Breaker (Phase 14)
- **CircuitBreaker class** — consecutive failure tracking, auto-trip at threshold
- **Enforcement degradation** — `getEffectiveEnforcement()` degrades advise/enforce to log when tripped
- **Auto-reset** — configurable cooldown, optional alert callback, `serialFallbackActive` getter for parallel -> serial degradation

#### Memory System (Phase 15)
- **SessionMemory** — in-memory Map-backed ephemeral storage
- **PersistentMemory** — JSON file-backed at `~/.arc/memory/`
- **Decay scoring** — `decayScore()` exponential decay with half-life + access boost
- **Memory search** — `searchMemories()` deterministic keyword/scope/type/recency ranking
- **Auto-extraction** — `extractMemories()` heuristic extraction (corrections, preferences, patterns, decisions)

#### Skill System (Phase 16)
- **Skill types** — `Skill`, `SkillStep`, `ContractSkill`, `ReviewOutput`
- **SkillRegistry** — register/unregister/findByTrigger
- **Directory loader** — `loadSkillsFromDirectory()` JSON skill file loader
- **MCP adapter** — `mcpToSkill()` MCP tool -> skill adapter

#### Task Management (Phase 17)
- **TaskStore** — JSON file-backed CRUD at `~/.arc/tasks/tasks.json`
- **MessageBus** — in-memory agent-to-agent message routing with subscribe
- **CronStore** — cron job persistence with `parseCronExpression()` (5-field cron)

#### Session Continuity (Phase 18)
- **SessionStore** — JSON-backed at `~/.arc/sessions.json`
- **Session lifecycle** — create/suspend/resume/complete
- **Resume detection** — `isResumeIntent()` heuristic detection of "continue"/"resume" intents

#### Context Management (Phase 19)
- **ContextManager** — turn tracking, token budget, compaction trigger
- **Token estimation** — `estimateTokens()` word/char heuristic
- **Compaction** — `compact(summarizer)` summarize old turns, keep last N verbatim

#### Three-Tier Permissions (Phase 20)
- **PermissionPolicy** — coordinator/interactive/worker tier defaults
- **Permission evaluation** — `evaluatePermission()` with deny > ask > allow precedence and audit logging
- **Worker restrictions** — blocks destructive ops (delete/spawn/deploy/push/force/reset/destroy)

#### Semantic Phase Indicators (Phase 21)
- **Phase detection** — `detectPhase(toolName)` deterministic tool -> phase mapping
- **AgentPhase type** — thinking/reading/writing/executing/reviewing/testing/deploying/idle
- **StreamEventBus** — typed event emitter for 10 stream event types

#### Skillify + Stuck Detector (Phase 22)
- **Pattern detection** — `detectRepeatedPatterns()` sliding window repeated sequence detection
- **Skill generation** — `generateSkillFromPattern()` auto-generate skill definitions from repeated patterns
- **StuckDetector** — Jaccard similarity on recent actions, cycling recovery strategies

#### Plugin Registry (Phase 23)
- **PluginRegistry** — JSON-backed at `~/.arc/plugins/installed.json`
- **Plugin lifecycle** — install/uninstall/enable/disable with semver compatibility check
- **PluginManifest** — capability declarations

#### Remote Agent Support (Phase 24)
- **RemoteAgentRegistry** — JSON-backed at `~/.arc/remote-agents.json`
- **Agent management** — register/unregister/updateStatus with HTTP health checks
- **Multi-transport** — HTTP, SSH, and MCP transport support

#### Dark Factory Mode (Phase 25)
- **FactoryController** — state machine (idle -> planning -> executing -> verifying -> gating -> completed)
- **FactorySpec** — waves, tasks, consensus gate config
- **Wave progression** — `advanceWave()` with wave result tracking

### Changed

- **Architecture** — evolved from single-package CLI/TUI to pnpm monorepo with 6 workspace packages
- **Adapter model** — tool support moved from hardcoded launch logic to pluggable `RuntimeAdapter` interface
- **Shared layer** — `PullResult.claudeMd` replaced with generic `adapterArtifacts` for tool-agnostic sync
- **Profile resolution** — now supports inheritance chains and workspace overrides before launch
- **Barrel exports** — 6 duplicate export conflicts in core barrel resolved during monorepo conversion

### Fixed

- **Cross-package imports** — `workspace:*` dependencies wired correctly, per-package tsconfig paths configured
- **Duplicate exports** — 6 conflicting re-exports in core barrel resolved

## [0.1.0] - 2026-03-28

### Added

- **Named profiles** — create, switch, delete, and import isolated agent configurations
- **Multi-tool support** — profiles target any agent CLI binary: `claude`, `gemini`, `codex`, or custom
- **Multi-tool auth detection** — OAuth credential reading for Claude (`.credentials.json`), Gemini (`oauth_creds.json`), and Codex (`auth.json` with JWT expiry decoding)
- **Auth flexibility** — OAuth, API key, AWS Bedrock, Google Vertex AI, and Foundry auth types
- **Secure storage** — API keys stored in the OS keyring with plaintext fallback
- **Shell integration** — wraps agent commands in bash, zsh, fish, and PowerShell
- **Environment isolation** — auth env vars sanitized between profiles to prevent credential leaks
- **TUI dashboard** — interactive terminal UI with views (Dash, Work, Profiles, Doctor, Settings, Guide), command palette (Ctrl+P), Photon/Carbon Night themes with persistence
- **Responsive ASCII logo** — 4-tier responsive logo (text, half-block, block, full) adapts to terminal height
- **Shared layer** — sync MCP servers, commands, CLAUDE.md, memory, and projects across profiles via `~/.arc/shared/`
- **Credential hot-swap** — [experimental] swap auth credentials without changing MCPs/settings/history
- **Self-update system** — `arc update` with npm registry check and TUI update banner
- **Lifecycle CLI** — `setup`, `update`, `teardown` managed from the same tool
- **Launch args** — per-profile default flags passed to the agent tool on every launch, displayed on launch
- **Profile ordering** — custom display order for profiles in the TUI
- **Bootstrap installers** — one-liner install for Windows (PowerShell) and macOS/Linux (bash)
- **Local dev install** — `pnpm install:local` / `pnpm uninstall:local` for shim-based dev workflow
- **Doctor command** — diagnostics for Node version, PATH, auth, shell integration, and config issues
- **Onboarding wizard** — interactive first-run setup with auto-detect of installed tools and batch import
- **Windows-first platform handling** — `cmd /c` for .cmd shim resolution, user PATH management, no `shell:true`
- **CI** — GitHub Actions CI on Ubuntu + Windows, automated release workflow with npm publish

### Fixed

- **Gemini/Codex auth status** — OAuth refresh token presence now means authenticated (not access token expiry)
- **TUI exit killing terminal** — proper alternate buffer cleanup, `process.exit(0)` on quit, `exitOnCtrlC: false`
- **Tool launch freezing** — `spawnSync` with `stdio:inherit` replaces async spawn for clean terminal handoff
- **Node 24 DEP0190 warnings** — `cmd /c` on Windows instead of `shell:true` throughout
- **Light mode contrast** — WCAG AA compliant dimmed/border colors, explicit `colors.text` on import hint
- **React hooks violation** — `useScreenSize()` moved above conditional returns in DashView

[Unreleased]: https://github.com/Codename-11/ARC/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/Codename-11/ARC/compare/v0.2.0...v0.4.0
[0.2.0]: https://github.com/Codename-11/ARC/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Codename-11/ARC/releases/tag/v0.1.0
