# DEVLOG.md — ARC Development Log

**Last updated:** 2026-04-03 (all 25 spec phases complete)

---

## Current State Summary

**Version:** 0.1.0 (released 2026-03-28)
**Branch:** `master`
**Spec:** v2.0 draft at `docs/spec/SPEC.md` (updated 2026-04-01)

ARC shipped v0.1.0 as a profile manager CLI/TUI. Since then, ~55 commits have landed on master implementing early phases of the v2.0 spec — the merger with Axiom-Supervisor into a unified agent runtime control plane.

---

## What Shipped in v0.1.0

- Named profiles with multi-tool support (Claude, Gemini, Codex)
- Multi-tool auth detection (OAuth, API key, Bedrock, Vertex, Foundry)
- OS keyring secure storage
- Shell integration (bash, zsh, fish, PowerShell)
- TUI dashboard (Ink): Dash, Work, Profiles, Doctor, Settings, Guide views
- Shared layer sync (MCP servers, commands, CLAUDE.md, memory, projects)
- Credential hot-swap (experimental)
- Self-update system
- Doctor diagnostics
- Onboarding wizard
- CI (GitHub Actions, Ubuntu + Windows matrix)

---

## Post-v0.1.0 Work Completed (v2.0 Spec Implementation)

Mapping commits since 2026-03-28 to spec phases:

### Phase 1: Monorepo Setup (DONE)
- Workspace packages created: `packages/core/`, `packages/cli/`, `packages/mcp/`, `packages/adapter-claude/`, `packages/adapter-openclaw/`
- `workspace:*` dependencies wired, cross-package imports fixed
- Per-package tsconfig paths configured
- 6 duplicate export conflicts in core barrel resolved

### Phase 2: Adapter Interface + Claude Code Adapter (DONE)
- `RuntimeAdapter` interface implemented with lifecycle methods (launch/terminate/isRunning)
- Claude Code adapter: `packages/adapter-claude/` with SDK bridge, auth, detect, import, shared
- Gemini CLI adapter: real lifecycle (launch/terminate/isRunning) wired
- Codex CLI adapter: cross-platform process management, real spawn/terminate
- OpenClaw adapter: `packages/adapter-openclaw/` with plugin manifest, RuntimeAdapter, 3 lifecycle hooks
- 27 adapter registry characterization tests
- `handleLaunch` wired to adapter lifecycle with `spawnSync` fallback

### Phase 5-6: Codex + Gemini + OpenClaw Adapters (DONE)
- All adapters declare spec-aligned capabilities
- `PullResult.claudeMd` replaced with generic `adapterArtifacts`

### Phase 7: Hook Pipeline (DONE)
- Hook type system + HookBus pipeline runner with 4-mode enforcement (log/warn/enforce/off)
- Source-classify hook (priority 1) + risk-classifier pure function
- Hook pipeline wired into `handleLaunch` via `createDefaultHookBus`
- Attempt-tracker factory (session + turn scoped retry counting)
- `auditCompletion()` pure function (status x confidence -> recommendation)
- `runWithRetry()` enforce-mode retry loop + `createDefaultPipeline`
- Supervision-gate hook factory (ALLOW/BLOCK parsing)
- Post-verify hook factory (pluggable health polling, exponential backoff)

### Phase 8: MCP Dual-Role (DONE)
- `@axiom-labs/arc-mcp` package with 5 MCP supervision tools
- `arc mcp serve` CLI with stdio transport (31 integration tests)
- HTTP server transport (`startHttpServer()`) with per-session auth
- CLI flags: `--transport http/--port/--auth-token/--require-auth`
- McpHostManager: connect/disconnect/list/getTools + `callTool()` with risk classification
- `arc mcp connect/list/disconnect` CLI commands wired to profiles

### Phase 9: Profile Inheritance + Workspace Selection (DONE)
- `inherits` field added to Profile type
- `resolveProfile()` engine for base + override resolution
- `resolveEffectiveProfile()` wired into launch, exec, shell, and MCP commands
- `loadWorkspaceConfig()` + `applyWorkspaceOverrides()` for `arc.json`
- `arc which` command showing resolved profile source

### Phase 10: Secret Management (DONE)
- Encrypted secret store: Argon2id KDF, AES-256-GCM per-entry encryption
- `arc secret` command group: set/get/list/delete
- Integrated into profile resolution

---

### Phase 3: Logging Framework (DONE — pre-existing)
- Structured JSONL log at `~/.arc/logs/structured.jsonl`
- `writeLogEvent()`, `logAction()`, `queryLogEvents()` in `core/logging.ts`
- `arc logs` CLI command with `--limit`, `--level`, `--component`, `--profile`, `--json` flags

### Phase 4: Graceful Shutdown + Health Checks (DONE — pre-existing)
- `runCommandWithLifecycle()` — signal forwarding (SIGINT/SIGTERM/SIGHUP), cleanup, exit code normalization
- `withLifecycleScope()` — registerCleanup/runCleanups pattern with signal handlers
- Health check types + `buildHealthReport()` in `core/health.ts`

### Phase 11: Cloud Sync (DONE)
- `SyncProvider` interface + `SyncConfig`, `SyncDelta`, `SyncChange` types
- `FilesystemSyncProvider` — shared directory sync with atomic writes, mtime change detection
- `SyncManager` — wraps any provider with cursor tracking and status

### Phase 14: Circuit Breaker (DONE)
- `CircuitBreaker` class — consecutive failure tracking, auto-trip at threshold
- `getEffectiveEnforcement()` — degrades advise/enforce to log when tripped
- Auto-reset after configurable cooldown, optional alert callback
- `serialFallbackActive` getter for parallel→serial degradation

### Phase 15: Memory System (DONE)
- `SessionMemory` — in-memory Map-backed ephemeral storage
- `PersistentMemory` — JSON file-backed at `~/.arc/memory/`
- `decayScore()` — exponential decay with half-life + access boost
- `searchMemories()` — deterministic keyword/scope/type/recency ranking
- `extractMemories()` — heuristic extraction (corrections, preferences, patterns, decisions)

### Phase 16: Skill System (DONE)
- `Skill`, `SkillStep`, `ContractSkill`, `ReviewOutput` types
- `SkillRegistry` — register/unregister/findByTrigger
- `loadSkillsFromDirectory()` — JSON skill file loader
- `mcpToSkill()` — MCP tool → skill adapter

### Phase 17: Task Management (DONE)
- `TaskStore` — JSON file-backed CRUD at `~/.arc/tasks/tasks.json`
- `MessageBus` — in-memory agent-to-agent message routing with subscribe
- `CronStore` — cron job persistence with `parseCronExpression()` (5-field cron)

### Phase 18: Session Continuity (DONE)
- `SessionStore` — JSON-backed at `~/.arc/sessions.json`
- create/suspend/resume/complete lifecycle
- `isResumeIntent()` — heuristic detection of "continue"/"resume" intents

### Phase 19: Context Management (DONE)
- `ContextManager` — turn tracking, token budget, compaction trigger
- `estimateTokens()` — word/char heuristic
- `compact(summarizer)` — summarize old turns, keep last N verbatim

### Phase 20: Three-Tier Permission Model (DONE)
- `PermissionPolicy` with coordinator/interactive/worker defaults
- `evaluatePermission()` — deny > ask > allow precedence with audit logging
- Worker tier blocks destructive ops (delete/spawn/deploy/push/force/reset/destroy)

### Phase 21: Semantic Phase Indicators (DONE)
- `detectPhase(toolName)` — deterministic tool→phase mapping
- `AgentPhase` type (thinking/reading/writing/executing/reviewing/testing/deploying/idle)
- `StreamEventBus` — typed event emitter for 10 stream event types

### Phase 22: Skillify + Stuck Detector (DONE)
- `detectRepeatedPatterns()` — sliding window repeated sequence detection
- `generateSkillFromPattern()` — auto-generate skill definitions
- `StuckDetector` — Jaccard similarity on recent actions, cycling recovery strategies

### Phase 23: Plugin Registry (DONE)
- `PluginRegistry` — JSON-backed at `~/.arc/plugins/installed.json`
- install/uninstall/enable/disable with semver compatibility check
- `PluginManifest` with capability declarations

### Phase 24: Remote Agent Support (DONE)
- `RemoteAgentRegistry` — JSON-backed at `~/.arc/remote-agents.json`
- register/unregister/updateStatus with HTTP health checks
- Supports http/ssh/mcp transports

### Phase 25: Dark Factory Mode (DONE)
- `FactoryController` — state machine (idle→planning→executing→verifying→gating→completed)
- `FactorySpec` with waves, tasks, consensus gate config
- `advanceWave()` progression with wave result tracking

---

### Phase 12: Web Dashboard (DONE)
- `packages/dashboard/` — raw `node:http` server, no Express dependency
- 10 REST API endpoints (overview, sessions, traces, risk, tasks, skills, memory, agents, factory, health)
- WebSocket server (RFC 6455) for real-time event push
- Nothing-designed frontend: Doto/Space Grotesk/Space Mono, OLED dark + warm light
- 9 modular view components (overview, sessions, traces, risk, tasks, skills, memory, agents, factory)
- Segmented progress bars, stat rows, tag system, phase indicators
- SPA router, API client, WS auto-reconnect, dark/light toggle

### Phase 13: OpenTelemetry Integration (DONE)
- `TelemetryProvider` — span lifecycle, trace IDs, sample rate, exporter dispatch
- Span helpers: session, preflight, hook, agent execution, tool use, postflight, circuit breaker
- `ConsoleExporter`, `JsonFileExporter` (JSONL at `~/.arc/traces/`), `OtlpExporter` (stub)
- All spans use `arc.*` attribute namespace per spec

---

## All Spec Phases Complete

Every phase (1–25) from SPEC.md v2.0 is now implemented. Remaining work is integration wiring and polish.

**Deferred to v2:** A2A protocol, prompt routing, agent personas/buddy system, S3 sync provider.

---

## FEATURES.md Backlog (Original v0.1 Items Still Open)

- Actionable Dash view (launch on Enter, ImportHint)
- Persist activity to Log view
- Surface profile metadata in detail pane
- Workspace-aware profile auto-selection (shell hook on `cd`)
- Quick profile switch overlay (Ctrl+S)
- Profile search/filter in Profiles view
- Environment preview before launch
- Per-tool shared layer namespaces
- Toast notifications
- MCP server management in TUI
- Policy layer
- Profile cloning/duplication
- Usage/audit log
- Launch history on Dash
- Dependabot config

---

## Package Layout (Current)

```
packages/
  core/           — Hook bus, risk classifier, config, types, health, lifecycle, process, workspace, adapters, secrets
  cli/            — Commander.js commands, TUI (Ink), auth, detect, import, shared layer, swap, update
  mcp/            — MCP server (5 supervision tools) + host manager + HTTP transport
  adapter-claude/ — Claude Code adapter (SDK bridge, auth, detect, import, shared)
  adapter-openclaw/ — OpenClaw adapter (plugin manifest, hooks, tools)
```

Plus the original `src/` tree in `packages/cli/src/` which contains the full v0.1 TUI and CLI.

---

## Notes

- The spec (SPEC.md v2.0) is comprehensive but phases 3-4 (logging, graceful shutdown) are P0 blockers that got skipped during the adapter/hook/MCP sprint.
- The monorepo conversion happened fast — some cross-package wiring may need cleanup.
- `feature/every-code-tui` branch exists but is not merged.
- Several dependabot PRs are open on remote.
- `.omx/` config files were deleted (GSD artifacts cleaned up).
