# DEVLOG.md — ARC Development Log

**Last updated:** 2026-04-03

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

## What's NOT Built Yet (Spec Phases Remaining)

| Phase | What | Priority | Status |
|---|---|---|---|
| **3** | Logging framework + `arc logs` | P0 | Not started |
| **4** | Graceful shutdown + health checks | P0 | Not started |
| **11** | Cloud sync (providers, conflict resolution) | P2 | Not started |
| **12** | Web dashboard (Express + WebSocket) | P2 | Not started |
| **13** | OpenTelemetry integration | P2 | Not started |
| **14** | Circuit breaker | P2 | Not started |
| **15** | Memory system (session/persistent/team) | P2 | Not started |
| **16** | Skill system (loader, registry, MCP adapter) | P2 | Not started |
| **17** | Task management (first-class tools) | P2 | Not started |
| **18** | Session continuity (thread resume, bg jobs) | P2 | Not started |
| **19** | Context management (auto-compaction) | P2 | Not started |
| **20** | Three-tier permission model | P2 | Not started |
| **21** | Semantic phase indicators | P2 | Not started |
| **22** | Skillify + stuck detector | P3 | Not started |
| **23** | Plugin registry | P3 | Not started |
| **24** | Remote agent support | P3 | Not started |
| **25** | Dark Factory mode | P3 | Not started |

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
