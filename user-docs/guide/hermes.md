# Hermes Agent Integration

[Hermes Agent](https://github.com/NousResearch/hermes-agent) is an open-source, self-improving AI agent framework by Nous Research. It features persistent memory, autonomous skill creation, a multi-channel gateway, and native MCP support. ARC can manage Hermes profiles alongside Claude Code, Codex, Gemini, and OpenClaw — bringing unified supervision, orchestration, and credential management to Hermes sessions.

## Overview

| Property | Value |
|----------|-------|
| **Config directory** | `~/.hermes/` |
| **Profile isolation** | `~/.hermes/profiles/<name>/` |
| **Config format** | YAML (`config.yaml`) + `.env` |
| **CLI binary** | `hermes` (Python / uv) |
| **Auth storage** | `~/.hermes/.env` (API keys), `~/.hermes/auth.json` (OAuth) |
| **MCP support** | Client + Server (stdio and HTTP) |
| **Gateway** | Telegram, Discord, Slack, WhatsApp, Signal, Email |
| **Identity file** | `SOUL.md` |

Hermes' profile system (`~/.hermes/profiles/`) maps naturally to ARC's profile model. Each Hermes profile gets isolated config, memory, sessions, skills, and gateway settings — the same isolation ARC provides for Claude Code, Codex, and Gemini.

## Setup

### 1. Install Hermes Agent

```bash
# Via uv (recommended)
uv tool install hermes-agent

# Or pip
pip install hermes-agent
```

### 2. Create an ARC profile

```bash
arc profile create my-hermes --tool hermes
```

### 3. Configure credentials

Hermes uses standard API keys. Set them in ARC's profile or let Hermes read from `~/.hermes/.env`:

```bash
# Via ARC secret management
arc secret set my-hermes OPENROUTER_API_KEY sk-or-...
arc secret set my-hermes ANTHROPIC_API_KEY sk-ant-...

# Or directly in Hermes
hermes config set OPENROUTER_API_KEY sk-or-...
```

### 4. Verify

```bash
arc doctor my-hermes
```

## Key Integration Points

### Profile Mapping

ARC profiles map to Hermes profiles. When ARC launches a Hermes session, it sets the appropriate environment and config directory:

```
ARC Profile: my-hermes
  └─ maps to → ~/.hermes/profiles/my-hermes/
       ├─ config.yaml     # Model, terminal, TTS settings
       ├─ .env             # API keys
       ├─ SOUL.md          # Agent personality
       ├─ memories/        # Persistent memory
       ├─ skills/          # Created + imported skills
       └─ sessions/        # Conversation history
```

### MCP Bridge

Hermes has full MCP support in both directions. This is the primary integration mechanism with ARC.

**ARC as MCP server for Hermes** — Hermes can consume ARC's supervision tools:

```yaml
# In ~/.hermes/config.yaml
mcp_servers:
  arc-supervisor:
    transport: stdio
    command: arc
    args: [mcp, serve]
```

This gives Hermes agents access to:
- `arc_expand_intent` — structured planning
- `arc_classify_risk` — risk assessment before actions
- `arc_derive_completion` — task completion criteria
- `arc_audit_completion` — verify results meet criteria
- `arc_explain_trace` — understand supervision decisions

**Hermes as MCP server for ARC** — ARC profiles can access Hermes conversations:

```bash
# Register Hermes MCP server in ARC
arc mcp add hermes-sessions --command "hermes mcp serve"
```

This exposes Hermes' 10 MCP tools to other ARC profiles:
- `conversation_list` / `conversation_get` — browse Hermes sessions
- `message_read` / `message_send` — read and write messages
- `event_poll` / `event_wait` — real-time event streaming
- `approval_*` — manage pending approvals

**Bidirectional bridge** — With both configured, a Claude Code profile can search Hermes sessions, and Hermes agents can invoke ARC's supervision pipeline:

```
Claude Code ←MCP→ ARC ←MCP→ Hermes Agent
     └─ reads Hermes sessions     └─ uses ARC risk classification
```

### Context File Compatibility

Hermes reads context files in priority order: `.hermes.md` > `AGENTS.md` > `CLAUDE.md` > `.cursorrules` > `SOUL.md`. Since ARC already manages `CLAUDE.md` through the [shared layer](/features/sync), Hermes automatically picks up shared instructions, conventions, and project context.

This means ARC's shared layer sync benefits Hermes without additional configuration — push a `CLAUDE.md` update to the shared layer and both Claude Code and Hermes profiles inherit it.

### Memory Interop

Both ARC and Hermes have persistent memory systems. They operate independently but can complement each other:

| System | Storage | Search | Scope |
|--------|---------|--------|-------|
| ARC Memory | Markdown files in `~/.arc/shared/memory/` | File-based | Cross-profile, cross-session |
| Hermes Memory | SQLite FTS5 | Full-text search with LLM summarization | Per-profile, cross-session |

ARC's memory is shared across all profiles via the shared layer. Hermes' memory is deeper (full-text search, dialectic user modeling via Honcho) but isolated to the Hermes profile. Together they provide broad cross-agent memory (ARC) and deep per-agent memory (Hermes).

### Gateway as a Channel

Hermes' unified gateway bridges Telegram, Discord, Slack, WhatsApp, Signal, and Email through a single process. When ARC supervises a Hermes profile, all messages from all gateway channels flow through ARC's hook pipeline.

This enables scenarios like:
- Risk detection on Telegram messages before Hermes acts on them
- Audit scoring on responses delivered via Discord
- Enforcement policies applied uniformly across all channels

## Use Cases

### Roundtable with Hermes

Include Hermes profiles in multi-agent discussions:

```
roundtable: What's the best approach for implementing a plugin system?
agents: claude-lead, my-hermes, gemini-review
rounds: 2
```

Hermes brings its persistent memory and skill library to the discussion — it may reference insights from previous conversations that other agents don't have.

### Delegate Research to Hermes

Hermes excels at research tasks thanks to its self-improving skill system and persistent memory. Delegate research from a Claude Code session:

```typescript
await delegator.delegate({
  from: 'claude-work',
  to: 'my-hermes',
  description: 'Research rate limiting patterns used in production Go APIs. Check your memory for prior findings.',
  priority: 'medium',
});
```

Hermes may already have relevant skills and memory from past research — making it faster at follow-up queries.

### Skill Sharing via MCP

Hermes creates and improves skills autonomously. Expose these to other ARC profiles through MCP:

1. Hermes creates a skill for parsing Kubernetes logs
2. Register Hermes as an MCP server in ARC
3. Claude Code profiles can invoke Hermes' skills through the MCP bridge

### Cross-Channel Supervision

Apply ARC's enforcement pipeline to Hermes' messaging channels:

```
User message via Telegram
  → Hermes Gateway receives
    → ARC hook pipeline runs (risk detection, enforcement)
      → Hermes processes (if allowed)
        → ARC audit scores the response
          → Hermes delivers via Telegram
```

In `enforce` mode, destructive actions requested via Telegram are blocked just as they would be in a terminal session.

### Dark Factory with Hermes Workers

Use Hermes profiles as [Dark Factory](/features/factory) workers alongside Claude and Codex:

- **Wave 1**: Claude profiles handle code generation
- **Wave 2**: Hermes profiles run research and documentation tasks (leveraging persistent memory)
- **Wave 3**: Codex profiles run sandboxed tests
- **Consensus gate**: Roundtable review across all three

Hermes' memory persistence means it retains context from previous factory runs — useful for iterative development cycles.

## Terminal Backends

Hermes supports multiple terminal backends, which affect how ARC interacts with it:

| Backend | Description | ARC Compatibility |
|---------|-------------|-------------------|
| `local` | Direct shell execution | Full — standard process wrap |
| `docker` | Sandboxed container | Full — ARC manages the Hermes process, Docker handles sandboxing |
| `ssh` | Remote execution | Works with [Remote Agents](/features/remote) |
| `modal` | Serverless (Modal.com) | Limited — no persistent process |
| `daytona` | Cloud dev environment | Works with Remote Agents |

::: tip
For ARC-managed Hermes profiles, the `local` or `docker` backends are recommended. Docker gives you sandboxing similar to Codex CLI's `full-auto` mode.
:::

## Comparison with OpenClaw

Both Hermes and OpenClaw are multi-channel agent runtimes with gateway capabilities. Here's how they differ from ARC's perspective:

| Aspect | Hermes Agent | OpenClaw |
|--------|-------------|----------|
| **ARC adapter** | Process wrap (Generic) | Native plugin |
| **Hook delivery** | MCP bridge | Direct lifecycle bus |
| **Language** | Python | TypeScript / Node.js |
| **Profile isolation** | `~/.hermes/profiles/` | `~/.openclaw/workspace-<profile>/` |
| **Memory** | Deep (SQLite FTS5 + Honcho) | Per-session |
| **Skills** | Self-improving, autonomous creation | Bundled + custom |
| **Channels** | 6 (Telegram, Discord, Slack, WhatsApp, Signal, Email) | 23+ channels + companion apps |
| **MCP** | Client + Server (stdio, HTTP) | Client + Server (stdio, SSE, HTTP) |
| **Identity file** | `SOUL.md` | `SOUL.md` + `AGENTS.md` |
| **Best for** | Research, memory-heavy workflows, skill building | Channel breadth, multi-agent orchestration, mobile |

Both are fully supported in ARC roundtables, task delegation, and Dark Factory workflows. Use them together for complementary strengths — Hermes for deep research and memory, OpenClaw for channel breadth and orchestration.
