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
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│  Claude  │  Codex   │  Gemini  │ OpenClaw │  Generic        │
│  Adapter │  Adapter  │  Adapter │  Adapter │  Adapter        │
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
│  Profiles & Config (~/.arc/)  ·  OS Keyring (credentials)    │
│  JSON stores (tasks, sessions, memory, plugins, agents)      │
│  JSONL traces  ·  OpenTelemetry Export (OTLP)                │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

When an agent is launched via `arc launch <profile>`:

```
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
[Source Classifier]          — human / agent / system / cron
    ↓
[Hook Pipeline]              — sequential by priority
    - check()                — pass / flag / block (deterministic)
    - inject()               — add structured metadata to context
    ↓
[Circuit Breaker]            — 3 consecutive failures → degrade + alert
    ↓
[Agent receives context]     — structured metadata, not freeform text
    ↓
[Agent responds]
    ↓
[Post-Process Hooks]         — memory-sync, post-verify, roundtable
    ↓
[Trace Written]              — JSONL + OpenTelemetry span
```

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

- Hook pipeline with 4-mode enforcement
- Risk classification (5-tier keyword-based)
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
