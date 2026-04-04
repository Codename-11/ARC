# Packages

ARC is structured as a pnpm monorepo with focused packages. Each package has a single responsibility and communicates through typed interfaces.

## Package Map

```
packages/
├── core/               # Zero adapter dependencies
├── cli/                # Commander.js commands + TUI (Ink)
├── mcp/                # MCP server + host manager
├── adapter-claude/     # Claude Code adapter
├── adapter-openclaw/   # OpenClaw adapter
└── dashboard/          # Web dashboard
```

## @axiom-labs/arc-core

The foundational package. Zero adapter dependencies — it provides the hook bus, risk classifier, config loader, type system, and all feature stores.

**Key modules:**

| Module | Responsibility |
|--------|---------------|
| `hook-bus.ts` | Hook registry + pipeline runner |
| `risk-classifier.ts` | 5-tier keyword-based risk classification |
| `source-classifier.ts` | Message source detection (human/agent/system/cron) |
| `circuit-breaker.ts` | Failure tracking + enforcement degradation |
| `retry-loop.ts` | Configurable retry with attempt tracking |
| `context-manager.ts` | Turn tracking, token budget, auto-compaction |
| `config-loader.ts` | Profile + config file loading and validation |
| `types.ts` | Shared TypeScript types for the entire system |
| `health.ts` | Health check types + report builder |
| `lifecycle.ts` | Signal forwarding, cleanup, exit normalization |
| `process.ts` | Process spawning and management |
| `workspace.ts` | `arc.json` loading + workspace overrides |
| `adapters.ts` | Adapter registry and capability types |
| `secrets.ts` | Encrypted secret store (Argon2id + AES-256-GCM) |
| `permissions.ts` | Three-tier permission model evaluation |
| `telemetry.ts` | OpenTelemetry provider + span helpers + exporters |
| `memory.ts` | Session + persistent memory, decay scoring, extraction |
| `skills.ts` | Skill registry, directory loader, MCP-to-skill adapter |
| `tasks.ts` | Task store, cron scheduling, message bus |
| `sessions.ts` | Session store with lifecycle management |
| `plugins.ts` | Plugin registry with semver compatibility |
| `remote-agents.ts` | Remote agent registry with health checks |
| `factory.ts` | Dark Factory state machine controller |
| `sync.ts` | Sync provider interface + filesystem provider |
| `logging.ts` | Structured JSONL logging |

## @axiom-labs/arc-cli

The CLI and TUI package. Depends on `core` for all business logic.

**CLI commands** — Commander.js command tree covering all ARC operations (profiles, launch, exec, shell, shared, doctor, status, setup, mcp, tasks, sessions, memory, skills, factory, sync, plugins, remote, secrets, telemetry, logs).

**TUI** — Ink + React interactive terminal UI:

| Component | Description |
|-----------|-------------|
| `DashView` | Main dashboard with profile overview and update banner |
| `ProfilesView` | Profile list with shared layer toggle |
| `WorkView` | Workspace shell with `/` commands |
| `DoctorView` | Diagnostics with repair action hints |
| `SettingsView` | Configuration and sync status |
| `GuideView` | In-app documentation |
| `SwapOverlay` | Credential hot-swap interface |
| `CommandPalette` | Quick-access command overlay |
| `OnboardingScreen` | First-run wizard with tool import |

## @axiom-labs/arc-mcp

MCP server and host manager package.

- **MCP Server** — exposes 5 supervision tools via stdio or HTTP transport
- **McpHostManager** — connect/disconnect/list/getTools + `callTool()` with risk classification
- **HTTP transport** — per-session auth, JSON-RPC, CORS support

## @axiom-labs/arc-adapter-claude

Claude Code-specific adapter with the deepest integration:

- **SDK bridge** — bidirectional JSON over stdio control protocol
- **Auth** — OAuth, API key, Bedrock, Vertex, Foundry credential management
- **Detect** — auto-detect Claude Code installation
- **Import** — import existing `~/.claude` configuration
- **Shared** — shared layer sync for Claude-specific files

## @axiom-labs/arc-adapter-openclaw

OpenClaw-specific adapter:

- **Plugin manifest** — `openclaw.plugin.json` generation
- **RuntimeAdapter** implementation with 3 lifecycle hooks
- **Chat middleware** — request/response interception
- **Session bridge** — state synchronization between ARC and OpenClaw

## @axiom-labs/arc-dashboard

Web dashboard package:

- **HTTP server** — raw `node:http`, no Express dependency
- **REST API** — 10 endpoints for system data
- **WebSocket** — RFC 6455 real-time event push
- **Frontend** — Nothing-designed SPA with 9 view components

## Dependency Graph

```
dashboard ──→ core
cli ──────→ core
mcp ──────→ core
adapter-claude ──→ core
adapter-openclaw ──→ core
```

All packages depend on `core`. No package depends on another non-core package. This keeps the dependency graph flat and allows independent development.

## Development

```bash
# Build a specific package
pnpm --filter @axiom-labs/arc-core build

# Test a specific package
pnpm --filter @axiom-labs/arc-mcp test

# Run dashboard in dev mode
pnpm --filter @axiom-labs/arc-dashboard dev

# Full build
pnpm build

# Full typecheck
pnpm typecheck
```
