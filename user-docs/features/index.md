# Feature Overview

ARC implements all 25 phases of the v2.0 specification. This section covers the major feature systems.

## Capability Matrix

| Feature | Status | CLI | TUI | Web |
|---------|--------|-----|-----|-----|
| [Tasks](/features/tasks) | Stable | `arc tasks` | -- | API |
| [Memory](/features/memory) | Stable | `arc memory` | -- | API |
| [Skills](/features/skills) | Stable | `arc skills` | -- | API |
| [Sessions](/features/sessions) | Stable | `arc sessions` | -- | API |
| [Web Dashboard](/features/dashboard) | Stable | `arc web` | -- | SPA |
| [Cloud Sync](/features/sync) | Stable | `arc sync` | Settings | -- |
| [Dark Factory](/features/factory) | Stable | `arc factory` | -- | API |
| [Telemetry](/features/telemetry) | Stable | `arc telemetry` | -- | API |
| Secrets | Stable | `arc secret` | -- | -- |
| Plugins | Stable | `arc plugins` | -- | -- |
| Remote Agents | Stable | `arc remote` | -- | API |
| Shared Layer | Stable | `arc shared` | Settings | -- |
| Credential Swap | Experimental | `arc swap` | Overlay | -- |

## Architecture Layers

Each feature maps to one or more layers in the ARC stack:

```
Features → Orchestration → Adapters → Protocols → Storage
```

- **Tasks, Memory, Skills, Sessions** live in the orchestration layer inside `packages/core/`
- **Dashboard** is a separate package at `packages/dashboard/`
- **Sync** uses the `SyncProvider` interface with pluggable backends
- **Telemetry** wraps OpenTelemetry with ARC-specific span helpers
- **Factory** is a state machine controller that orchestrates adapters

## Shared Layer

The shared layer syncs configuration across profiles — MCP servers, commands, CLAUDE.md content, memory, and projects. It lives in `~/.arc/shared/` and can be enabled per-profile.

```bash
arc shared enable work --memory --claude-md
arc shared sync
arc shared status
```

See [Cloud Sync](/features/sync) for cross-machine synchronization.

## Secrets

An encrypted secret store using Argon2id KDF and AES-256-GCM per-entry encryption.

```bash
arc secret set DB_TOKEN "my-secret-token"
arc secret get DB_TOKEN
arc secret list
arc secret delete DB_TOKEN
```

## Plugins

JSON-backed plugin registry with semver compatibility checking.

```bash
arc plugins list
arc plugins install ./my-plugin
arc plugins enable my-plugin
arc plugins disable my-plugin
arc plugins uninstall my-plugin
```

Plugins are loaded from `~/.arc/plugins/` and can add commands, views, and integrations.

::: warning
Plugins run in the same process as ARC. Only install plugins you trust.
:::

## Remote Agents

Register and health-check remote agent endpoints accessible over HTTP, SSH, or MCP transports.

```bash
arc remote register https://staging.example.com --transport http
arc remote list
arc remote check            # Health-check all registered remotes
arc remote remove staging
```
