# Architecture Overview

ARC is a layered runtime control plane. Each layer has a clear responsibility and communicates through typed interfaces.

## High-Level Stack

```
┌─────────────────────────────────────────────────────────────┐
│                     ARC CLI / TUI / Web                      │
│  Profiles · Credentials · Dashboard · Doctor · Onboarding    │
│  TUI: quick ops (Ink)  ·  Web: deep observability            │
├─────────────────────────────────────────────────────────────┤
│                    Orchestration Layer                        │
│  Hook Pipeline · Risk Classifier · Retry Loop · Roundtable   │
│  Session Tracker · Alert Engine · Scope Tracker · Traces     │
│  Circuit Breaker · Dark Factory Controller                   │
├─────────┬─────────┬─────────┬──────────┬─────────┬──────────┤
│ Claude  │ Codex   │ Gemini  │ OpenClaw │ Hermes  │ Generic  │
│ Adapter │ Adapter │ Adapter │ Adapter  │ Adapter │ Adapter  │
│ SDK +   │ Process │ Process │ Plugin   │ Process │ MCP      │
│ Hooks + │ Wrap +  │ Wrap +  │ API +    │ Wrap +  │ Server   │
│ Plugin  │ MCP +   │ MCP +   │ Hooks    │ MCP     │ or HTTP  │
│ System  │ JSON    │ stdio   │          │ Bridge  │          │
├─────────┴─────────┴─────────┴──────────┴─────────┴──────────┤
│                     Protocol Layer                           │
│  MCP Host (connect to tool servers)                          │
│  MCP Server (expose ARC supervision as tools)                │
│  A2A Agent Cards (capability discovery + task delegation)    │
├─────────────────────────────────────────────────────────────┤
│                      Storage Layer                           │
│  Profiles & Config (~/.arc/)  ·  OS Keyring (credentials)    │
│  JSON stores (tasks, sessions, memory, plugins, agents)      │
│  JSONL traces  ·  OpenTelemetry Export (OTLP)                │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

When an agent is launched via `arc launch <profile>`:

<ArcFlow diagram="data-flow" height="280px" />

<ArcFlow diagram="architecture" height="240px" />

## Design Principles

1. **Deterministic over probabilistic** — binary checks first (file changed? build passed?), LLM only sees structured metadata. Same input, same output.

2. **Safe by default** — `log` mode, never `enforce` unless explicitly opted in. No audit loop traps.

3. **Pluggable adapters** — new runtime = new adapter, zero core changes. Common interface, runtime-specific integration depth.

4. **Profile-scoped everything** — switch profile = switch identity + credentials + adapter + hook config + enforcement mode + launch flags + MCP servers.

5. **Graceful degradation** — hook error = skip + log, never crash the pipeline. Watchdog unreachable = warn, don't block.

6. **Protocol-native** — MCP for tool integration, A2A for agent orchestration. Standards over custom wire formats.

7. **Observable** — every supervision decision produces a trace. Every trace is queryable.

8. **Dark Factory ready** — architecture supports fully autonomous operation: spec in, software out, with ARC as the control plane.

## Layer Responsibilities

### Presentation Layer (CLI / TUI / Web)

- CLI: Commander.js commands for all operations
- TUI: Ink + React interactive terminal UI (profiles, doctor, settings, guide, workspace shell)
- Web: REST API + WebSocket + SPA dashboard for deep observability

### Orchestration Layer

- Hook pipeline with 4-mode enforcement (8 hooks in default pipeline)
- Risk classification (5-tier keyword-based)
- Interagent routing (bot→bot loop suppression, roundtable-aware)
- Roundtable multi-agent discussions (trigger detection, turn management, synthesis)
- Task delegation protocol (delegate/accept/complete/fail with validated transitions)
- Retry loops with configurable attempt tracking
- Circuit breaker with auto-degradation
- Session tracking and context management
- Dark Factory state machine

### Adapter Layer

Each adapter implements `RuntimeAdapter` with varying integration depth. See [Adapters](/architecture/adapters) for the full interface and capability matrix.

### Protocol Layer

- **MCP Host** — connect to external MCP servers (stdio, http, sse, ws transports)
- **MCP Server** — expose ARC supervision as 5 MCP tools
- **A2A** — agent card generation, capability discovery, task delegation

See [MCP Protocol](/architecture/mcp) for details.

### Storage Layer

All state is stored in `~/.arc/` as JSON files. Credentials use the OS keyring. Traces export to JSONL and optionally OTLP.

See [Configuration](/reference/configuration) for the full data layout.

## Agent Client + Roundtable (internal)

ARC includes an internal **agent-client** layer that spawns a profile's CLI tool (`claude`, `codex`, `gemini`) with a prompt and captures structured output. This is the substrate for programmatic orchestration — the CLI tool's own tool use, streaming, and MCP integration flow through unchanged.

Modules:

| Module | Purpose |
|--------|---------|
| `packages/core/src/agent-client/` | One-shot CLI spawn with per-tool stream parsers and MCP config injection |
| `packages/core/src/agent/` | Tool registry + agent loop for tool-use dispatch |
| `packages/core/src/knowledge/` | Static + runtime system prompt composition (ARC feature knowledge) |
| `packages/core/src/hooks/roundtable.ts` | Multi-agent discussion state machine (turns, roles, synthesis) |

These modules are internal building blocks — not user-facing yet. The shipped `roundtable` hook drives in-session discussions when the trigger phrases are used; the orchestrator that loops over agents programmatically is tracked separately.

Coming soon:

- `arc chat` — terminal REPL over a chosen profile with read-only / supervised / autonomous permission modes
- `arc roundtable <topic> --agents a,b,c` — one-shot multi-agent discussion from the CLI
- Dashboard chat panel and roundtable configurator

See [docs/plans/ai-and-roundtable.md](https://github.com/Codename-11/ARC/blob/master/docs/plans/ai-and-roundtable.md) for the full design.
