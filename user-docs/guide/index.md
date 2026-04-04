# What is ARC?

ARC (Agent Runtime Control) is a **unified control plane** for AI coding agents. It started as a profile manager for agent CLIs (v0.1) and has since absorbed the [Axiom-Supervisor](https://github.com/Codename-11/axiom-supervisor) project, implementing all 25 phases of the [v2.0 spec](https://github.com/Codename-11/ARC/blob/master/docs/spec/SPEC.md).

One binary. One config directory (`~/.arc/`). Every agent runtime — Claude Code, Codex CLI, Gemini CLI, OpenClaw, or anything that speaks MCP/HTTP/stdio.

## The Problem

If you work with multiple AI coding agents, you end up with:

- Separate config directories per tool, no way to switch accounts
- No shared context between agents working on the same project
- No supervision or safety rails across different runtimes
- No unified view of what your agents are doing

## What ARC Does

| Layer | Capabilities |
|-------|-------------|
| **Identity** | Named profiles, credentials, auth (OAuth/API key/Bedrock/Vertex/Foundry), OS keyring, env isolation |
| **Launch** | Tool detection, shell shims, per-profile flags, workspace-aware auto-selection via `arc.json` |
| **Adapters** | Claude Code (SDK bridge + hooks + plugin), Codex CLI, Gemini CLI, OpenClaw, Generic (MCP/HTTP) |
| **Supervision** | Hook pipeline (4-mode enforcement), risk classification, preflight/postflight, retry loops, circuit breaker |
| **MCP** | Dual-role: host (connect to tool servers) and server (expose 5 supervision tools via stdio/HTTP) |
| **Memory** | Session + persistent memory, exponential decay scoring, keyword search, auto-extraction |
| **Skills** | Directory-based skill loading, MCP-to-skill adapters, self-improving skillify, stuck detector |
| **Tasks** | Task CRUD, cron scheduling, agent-to-agent message bus |
| **Sessions** | Create/suspend/resume/complete lifecycle, resume-intent detection |
| **Telemetry** | OpenTelemetry spans, JSONL + console + OTLP exporters |
| **Dashboard** | REST API (10 endpoints), WebSocket real-time push, SPA with 9 views |
| **Dark Factory** | Autonomous operation mode: spec in, software out |

## Design Principles

1. **Deterministic over probabilistic** — binary checks first, LLM only sees structured metadata
2. **Safe by default** — `log` mode by default, never `enforce` unless explicitly opted in
3. **Pluggable adapters** — new runtime = new adapter, zero core changes
4. **Profile-scoped everything** — switch profile = switch identity + credentials + adapter + hooks
5. **Graceful degradation** — hook error = skip + log, never crash the pipeline
6. **Protocol-native** — MCP for tool integration, A2A for agent orchestration
7. **Observable** — every supervision decision produces a trace
8. **Dark Factory ready** — supports fully autonomous operation as the control plane

## Quick Tour

```bash
# Install and open the TUI
arc

# Create profiles for different tools/accounts
arc create work --tool claude --auth-type oauth
arc create gemini-dev --tool gemini --auth-type api-key

# Switch and launch
arc use work
arc launch

# Open the web dashboard
arc web

# Check everything is healthy
arc doctor
```

## Next Steps

- **[Getting Started](/guide/getting-started)** — install ARC and create your first profile
- **[Profiles](/guide/profiles)** — manage accounts across tools
- **[Features](/features/)** — explore tasks, memory, skills, sessions, and more
- **[Architecture](/architecture/)** — understand the adapter and hook pipeline design
