# Features

ARC ships with a full set of tools for managing, supervising, and orchestrating AI coding agents. Everything works across three interfaces — **CLI** for scripting and power users, **TUI** for interactive terminal sessions, and **Web Dashboard** for browser-based monitoring and management.

## Interface Capability Matrix

| Feature | CLI | TUI | Web |
|---------|:---:|:---:|:---:|
| [Profiles](/guide/profiles) | Full CRUD | Full CRUD + launch | Switch + delete |
| [Tasks](/features/tasks) | Full CRUD + cron | Full CRUD | Full CRUD |
| [Memory](/features/memory) | Search, prune, stats | Search, browse, delete | Add, search, filter, delete |
| [Skills](/features/skills) | Load, info, list | Reload, detail view | Reload, remove |
| [Sessions](/features/sessions) | Full lifecycle | Interactive shell | Complete, suspend |
| [Hooks & Supervision](/features/hooks) | Per-profile config | -- | Live pipeline monitor |
| [Secrets & Credentials](/features/secrets) | Full CRUD | -- | -- |
| [Permissions](/features/permissions) | Per-launch config | -- | -- |
| [Web Dashboard](/features/dashboard) | `arc web` | -- | 14-view SPA |
| [Cloud Sync](/features/sync) | Full (configure, push, pull) | Pull/push per-profile | Pull/push |
| [Telemetry](/features/telemetry) | Traces, logs, stats | Auto-refresh viewer | Traces view |
| [Plugins](/features/plugins) | Full CRUD | -- | Enable/disable |
| [Remote Agents](/features/remote) | Full CRUD + health | Full CRUD + health | Full CRUD + health |
| [Orchestration](/features/orchestration) | Roundtable, delegation | -- | Hook monitor, agents |
| [Credential Swap](/features/swap) | `arc swap` | Overlay | -- |
| [Dark Factory](/features/factory) | Start, status, abort | -- | Status, abort, wave viz |
| [Shell Integration](/guide/shell-integration) | `arc shell-init` | -- | -- |

::: tip
Most features are available across all three interfaces. The CLI is the most complete; the TUI excels at interactive workflows; the Web Dashboard is best for monitoring and oversight.
:::

## Feature Categories

### Identity & Access

**[Profiles](/guide/profiles)** — Named agent identities with tool binding, credentials, enforcement settings, and hook config. Profiles can inherit from each other and share settings via the sync layer.

**[Authentication](/guide/authentication)** — Five auth types (OAuth, API key, AWS Bedrock, Google Vertex AI, Foundry) with OS keyring storage and per-profile credential isolation.

**[Secrets](/features/secrets)** — Encrypted secret store using Argon2id KDF and AES-256-GCM. Per-entry encryption with interactive or stdin input.

**[Permissions](/features/permissions)** — Three-tier permission model (coordinator, interactive, worker) with deny > ask > allow evaluation and audit logging.

**[Credential Swap](/features/swap)** — Capture and hot-swap auth credentials between profiles without changing MCP servers, settings, or history. Experimental.

### Supervision & Safety

**[Hooks & Supervision](/features/hooks)** — Eight-hook pipeline running on every message. Four enforcement modes (off, log, advise, enforce). Five risk tiers. Circuit breaker for graceful degradation.

**[Orchestration](/features/orchestration)** — Multi-agent roundtable discussions with roles and turns. Task delegation between profiles. Interagent routing to prevent message loops.

**[Dark Factory](/features/factory)** — Autonomous operation mode. Define a spec, ARC executes it in waves with consensus gates and verification steps.

### Data & Automation

**[Tasks](/features/tasks)** — Task CRUD with priority, assignee, and status tracking. Cron scheduling with 5-field expressions. Agent-to-agent message bus.

**[Memory](/features/memory)** — Three scopes (session, persistent, shared) with exponential decay relevance scoring. Keyword search and auto-extraction from session logs.

**[Skills](/features/skills)** — Directory-based skill loading with MCP-to-skill adapters. Self-improving skillify meta-skill and stuck detector for loop detection.

**[Sessions](/features/sessions)** — Full session lifecycle (create, suspend, resume, complete) with resume-intent detection and checkpoint storage.

### Infrastructure

**[Web Dashboard](/features/dashboard)** — 14-view browser SPA with REST API, WebSocket real-time updates, and full CRUD for tasks, memory, agents, and more. Live hook pipeline monitor for supervision visibility.

**[Cloud Sync](/features/sync)** — Filesystem-based sync with atomic writes and mtime detection. Syncs config, shared layer, tasks, and memory. S3 provider planned.

**[Telemetry](/features/telemetry)** — OpenTelemetry integration with seven span types. Three exporters (console, JSONL file, OTLP). Structured logging.

**[Plugins](/features/plugins)** — JSON-backed plugin registry with semver compatibility. Five capability types: adapter, hook, skill, MCP, dashboard.

**[Remote Agents](/features/remote)** — Register and health-check agent endpoints over HTTP, SSH, or MCP transports.

### Integrations

**[OpenClaw](/guide/openclaw)** — Native plugin adapter running inside OpenClaw Gateway. Full hook pipeline access across 23+ messaging channels.

**[Hermes Agent](/guide/hermes)** — Process wrapper with bidirectional MCP bridge. Persistent memory interop and context file compatibility.

**[Shell Integration](/guide/shell-integration)** — Shell shims for bash, zsh, fish, and PowerShell. Profile-aware `arc shell` and `arc exec` for environment isolation.

**[MCP Protocol](/architecture/mcp)** — Dual-role: host (connect to external MCP servers) and server (expose five supervision tools via stdio or HTTP).
