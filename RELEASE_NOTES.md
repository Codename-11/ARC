# ARC v0.2.0

Major release — ARC evolves from a profile manager into a **unified agent runtime control plane**, implementing all 25 phases of the v2.0 spec.

## Highlights

- **Monorepo architecture** — 6 packages: core, cli, mcp, adapter-claude, adapter-openclaw, dashboard
- **Adapter interface** — pluggable runtime adapters for Claude Code, Codex CLI, Gemini CLI, OpenClaw, and generic agents
- **Hook pipeline** — 4-mode enforcement (off/log/advise/enforce), risk classification, circuit breaker
- **MCP dual-role** — ARC as MCP host (connect to servers) and MCP server (5 supervision tools)
- **Multi-account auth** — `arc auth` command group: login/status/refresh/whoami per profile
- **Credential hot-swap** — swap OAuth accounts for desktop apps (Claude Desktop, Codex Desktop) with profile bridge
- **Web dashboard** — Nothing-designed UI at `arc web`, 9 views, live WebSocket updates, REST API
- **TUI views** — Tasks, Memory, Skills, Sessions views with Nothing design system
- **Memory system** — session/persistent scopes, relevance search, auto-extraction from session logs
- **Skill system** — registry, directory loader, MCP-to-skill adapter, skillify, stuck detector
- **Task management** — CRUD, cron scheduling, agent-to-agent messaging
- **Session continuity** — create/suspend/resume/complete lifecycle, auto-resume detection
- **Cloud sync** — filesystem provider, SyncManager with cursor tracking
- **Telemetry** — OpenTelemetry-compatible spans, JSON/console/OTLP exporters
- **Dark Factory** — state machine controller for autonomous wave-based execution
- **194 new unit tests** covering all Phase 11-25 modules
- **VitePress docs site** — 23 content pages with Nothing design theme

## Install

```bash
npm install -g @axiom-labs/arc-cli
arc setup
```

Or use the bootstrap one-liner:

**PowerShell:**
```powershell
irm https://raw.githubusercontent.com/Codename-11/ARC/master/scripts/bootstrap.ps1 | iex
```

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/Codename-11/ARC/master/scripts/bootstrap.sh | bash
```

## New Commands

```
arc auth status/login/refresh/whoami    Multi-account management
arc tasks list/create/update/stop       Task management
arc memory list/search/prune/stats      Memory system
arc skills list/load/info               Skill registry
arc sessions list/resume/complete       Session continuity
arc web [--port]                        Web dashboard
arc telemetry traces/status             Trace inspection
arc factory status/abort                Dark Factory control
arc remote list/add/remove/check        Remote agents
arc plugins list/install/uninstall      Plugin registry
arc sync status/push/pull/configure     Cloud sync
arc swap from-profile <name>            Bridge profile → desktop app
arc launch --dashboard                  Launch with web dashboard
```

## Breaking Changes

None — v0.1 profiles and config are fully compatible.

## Feedback

Please report issues at https://github.com/Codename-11/ARC/issues
