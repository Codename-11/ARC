# What is ARC?

ARC (Agent Runtime Control) is a **unified control plane** for AI coding agents. One binary, one config directory (`~/.arc/`), every agent runtime — Claude Code, Codex CLI, Gemini CLI, OpenClaw, Hermes Agent, or anything that speaks MCP, HTTP, or stdio.

ARC gives you **profiles** (isolated identities with credentials, settings, and hooks), a **supervision pipeline** (risk detection, enforcement, audit), and **multi-agent orchestration** (roundtable discussions, task delegation, Dark Factory) — all from the CLI, a terminal dashboard, or a web UI.

## The Problem

If you work with multiple AI coding agents, you end up with:

- **Scattered configs** — separate directories per tool, no way to switch accounts without juggling env vars
- **No shared context** — agents working on the same project can't see each other's memory, skills, or task state
- **No safety rails** — different runtimes have different permission models, none of them coordinated
- **No visibility** — no unified view of what your agents are doing, which sessions are active, or what risks they're taking

## How ARC Solves This

**One profile = one agent identity.** A profile bundles a tool (Claude, Gemini, Codex, etc.), credentials (OAuth, API key, Bedrock, Vertex), enforcement settings, and hook config. Switch profiles to switch everything — credentials, adapter, hooks, environment.

```bash
arc profile create work --tool claude --auth-type oauth
arc profile create review --tool gemini --auth-type api-key
arc use work && arc launch     # Claude Code with 'work' credentials
arc use review && arc launch   # Gemini CLI with 'review' credentials
```

**Three interfaces, same capabilities:**

| | CLI | TUI | Web |
|---|---|---|---|
| **Profile management** | Full CRUD | Full CRUD | Switch + delete |
| **Task management** | Full CRUD | Full CRUD | Full CRUD |
| **Memory** | Search, prune | Search, browse, delete | Add, search, filter, delete |
| **Skills** | Load, info | Reload, detail | Reload, remove |
| **Sessions** | Full lifecycle | Interactive shell | Complete, suspend |
| **Remote agents** | Full CRUD + health | Full CRUD + health | Full CRUD + health |
| **Supervision** | Per-profile config | -- | Live hook pipeline monitor |
| **Dark Factory** | Start, status, abort | -- | Status, abort, wave viz |
| **Plugins** | Full CRUD | -- | Enable/disable |
| **Sync** | Full | Pull/push | Pull/push |
| **Telemetry** | Traces, logs | Auto-refresh viewer | Traces view |
| **Credentials** | 5 auth types + secrets | Swap overlay | -- |

**Supervision runs everywhere.** Every message — whether from a terminal session, a Telegram channel via OpenClaw, or a cron-triggered factory wave — passes through the same hook pipeline: source classification, risk detection, interagent routing, audit scoring, and enforcement gating.

## Core Concepts

### Profiles

A profile is an isolated agent identity. It points to a tool, holds credentials, and carries its own settings. Profiles can inherit from other profiles, share a sync layer, and participate in multi-agent orchestration.

```
~/.arc/profiles/work/        # Claude Code, OAuth, enforce mode
~/.arc/profiles/review/      # Gemini CLI, API key, advise mode
~/.arc/profiles/factory/     # Codex CLI, API key, worker tier
```

### Hook Pipeline

Eight hooks run in priority order on every message. Four enforcement modes (`off`, `log`, `advise`, `enforce`) control whether violations are ignored, recorded, flagged, or blocked. A circuit breaker auto-downgrades enforcement after repeated failures.

### Adapters

Each tool gets an adapter that handles launch, teardown, and supervision integration. Claude Code gets the deepest integration (SDK + plugin + HTTP hooks). OpenClaw runs as a native plugin inside the Gateway. Hermes bridges via MCP. Generic adapters handle anything else.

### Orchestration

**Roundtable discussions** let multiple agents debate a topic with assigned roles (advocate, critic, neutral) across configurable rounds. **Task delegation** hands work from one profile to another with status tracking. **Dark Factory** chains waves of autonomous tasks with consensus gates.

## Quick Tour

```bash
# Install and open the TUI dashboard
arc

# Create profiles for different tools
arc profile create work --tool claude --auth-type oauth
arc profile create gemini-dev --tool gemini --auth-type api-key

# Switch and launch
arc use work
arc launch

# Open the web dashboard
arc web

# Check system health
arc doctor

# Start a multi-agent discussion
# (from within any agent session)
roundtable: Should we use REST or GraphQL? agents: work, gemini-dev rounds: 2
```

## Next Steps

- **[Getting Started](/guide/getting-started)** — install ARC and create your first profile
- **[Profiles](/guide/profiles)** — manage accounts and credentials across tools
- **[Features](/features/)** — explore tasks, memory, skills, sessions, and more
- **[Architecture](/architecture/)** — understand the adapter and hook pipeline design
- **[OpenClaw](/guide/openclaw)** / **[Hermes](/guide/hermes)** — integrate additional agent runtimes
