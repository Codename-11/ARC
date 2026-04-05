# OpenClaw Integration

ARC provides first-class support for [OpenClaw](https://openclaw.ai/) through a native plugin adapter. Unlike other runtimes that ARC wraps as subprocesses, the OpenClaw adapter runs **inside** the OpenClaw Gateway process itself — giving ARC direct access to OpenClaw's lifecycle bus, tool registry, and session state.

## How It Works

OpenClaw uses a plugin architecture. ARC ships as `@axiom-labs/arc-adapter-openclaw`, which registers:

- **3 lifecycle hooks** — `before_prompt_build`, `agent_end`, `session_end`
- **5 supervision tools** — intent expansion, risk classification, completion derivation, audit, and trace explanation

When OpenClaw loads the ARC plugin, the full [hook pipeline](/features/hooks) runs inside the Gateway process. Every message goes through source classification, risk detection, interagent routing, roundtable orchestration, audit scoring, and supervision gating — the same pipeline that runs for Claude Code.

```
OpenClaw Gateway
  └─ ARC Plugin (loaded via jiti)
       ├─ beforePromptBuild → runs pre-message hooks, injects [ARC] metadata
       ├─ agentEnd → runs post-message hooks, audit check, retry signal
       └─ sessionEnd → clears hook state
```

## Setup

### 1. Install the plugin

```bash
openclaw plugins install @axiom-labs/arc-adapter-openclaw
```

### 2. Create an ARC profile

```bash
arc profile create my-openclaw --tool openclaw
```

### 3. Configure the plugin

In your OpenClaw configuration, add the ARC plugin with your profile name:

```json
{
  "plugins": {
    "arc": {
      "profileName": "my-openclaw",
      "enforcementMode": "advise"
    }
  }
}
```

### 4. Verify

```bash
arc doctor my-openclaw
```

The doctor checks:
- OpenClaw config directory exists (`~/.openclaw/`)
- Plugin manifest is loadable
- Credential status (OpenClaw uses upstream provider credentials — Anthropic, OpenAI, etc.)

## Capabilities

| Feature | Status |
|---------|--------|
| Hook pipeline (all 8 hooks) | Supported |
| Risk detection & enforcement | Supported |
| Roundtable discussions | Supported |
| Task delegation | Supported |
| Interagent routing | Supported |
| Supervision tools (5) | Registered (stubs) |
| MCP server exposure | Not supported |
| Process lifecycle (spawn/kill) | Not applicable — plugin model |
| SDK control protocol | Not supported |
| Credential hot-swap | Via ARC profile env |

::: tip Plugin vs Process
OpenClaw is the only adapter that runs as a **native plugin** rather than a wrapped process. ARC doesn't spawn or terminate OpenClaw — it hooks into the Gateway's event bus directly. This means lower overhead and tighter integration, but ARC can't start/stop the Gateway for you.
:::

## Plugin Manifest

The adapter ships with `openclaw.plugin.json`:

```json
{
  "id": "arc",
  "name": "ARC Agent Supervisor",
  "description": "Profile-based supervision, policy enforcement, and agent tools.",
  "version": "2.0.0",
  "configSchema": {
    "properties": {
      "profileName": { "type": "string" },
      "enforcementMode": { "type": "string", "enum": ["off", "log", "advise", "enforce"] }
    },
    "required": ["profileName"]
  }
}
```

## Lifecycle Hooks

### beforePromptBuild

Fires before every message is sent to the model. ARC runs its pre-message hook pipeline and returns metadata to prepend to the system prompt:

```
[ARC] source=user | risk=file-modification | enforcement=advise
[ARC] roundtable=active | topic="Auth refactor approach" | turn=gemini (round 2/3)
```

This gives the model awareness of ARC's supervision context without requiring SDK-level control.

### agentEnd

Fires after the model responds. ARC runs its post-message pipeline — including the audit-score hook. In `enforce` mode, if the audit confidence is below 0.4, ARC signals a retry:

```typescript
// Low-confidence audit → signal retry
{ continue: true, continueReason: "ARC audit confidence below threshold (0.38)" }

// Passing audit → proceed normally
{ continue: false }
```

### sessionEnd

Clears all ephemeral hook state (risk scores, roundtable state, audit results) for the session.

## Supervision Tools

The plugin registers 5 tools that OpenClaw agents can invoke during conversations:

| Tool | Purpose |
|------|---------|
| `arc_expand_intent` | Expand user intent into a structured plan |
| `arc_classify_risk` | Classify risk tier of a proposed action |
| `arc_derive_completion` | Derive completion criteria for a task |
| `arc_audit_completion` | Audit whether a result satisfies criteria |
| `arc_explain_trace` | Explain a supervision trace entry |

All tools are registered as `optional: true` — agents can use them but aren't required to.

## Use Cases

### Multi-Agent Roundtable with OpenClaw

OpenClaw profiles work as first-class participants in ARC roundtables:

```
roundtable: Should we use WebSockets or SSE for real-time updates?
agents: claude-work, my-openclaw, gemini-review
rounds: 2
```

The interagent routing hook ensures messages flow correctly — OpenClaw agents can speak freely during active roundtables without `@mention` requirements.

### Cross-Runtime Task Delegation

Delegate tasks from Claude to OpenClaw (or vice versa):

```typescript
await delegator.delegate({
  from: 'claude-lead',
  to: 'my-openclaw',
  description: 'Research the best WebSocket library for our stack',
  priority: 'medium',
});
```

### Shared Supervision Across Channels

Since OpenClaw Gateway bridges 23+ messaging channels (Telegram, Discord, Slack, WhatsApp, etc.), ARC's supervision pipeline applies uniformly to all of them. A message from Telegram gets the same risk detection, audit scoring, and enforcement as a message from the CLI.

### Dark Factory Waves

OpenClaw profiles can participate in [Dark Factory](/features/factory) waves alongside Claude and Codex profiles. The plugin architecture means OpenClaw agents receive ARC's behavioral constraints through the `beforePromptBuild` hook rather than instructions files.

## MCP Interop

OpenClaw supports MCP as both client and server. While the ARC adapter itself doesn't add MCP support, you can:

1. **Connect OpenClaw to ARC's MCP server** — ARC exposes supervision tools via MCP that OpenClaw can consume as an MCP client
2. **Connect ARC to OpenClaw's MCP server** — `openclaw mcp serve` exposes conversation and session tools that ARC profiles can consume

```yaml
# In OpenClaw config — connect to ARC's MCP server
mcp:
  servers:
    arc-supervisor:
      transport: stdio
      command: arc
      args: [mcp, serve]
```

```bash
# In ARC — connect to OpenClaw's MCP server
arc mcp add openclaw-sessions --command "openclaw mcp serve"
```

This bidirectional MCP bridge lets agents in either system access the other's tools.

## Comparison with Claude Code Adapter

| Aspect | Claude Code | OpenClaw |
|--------|-------------|----------|
| Integration model | Process wrap + SDK + plugin | Native plugin only |
| Hook delivery | SDK messages + HTTP callbacks | Plugin lifecycle bus |
| Process control | Full (spawn/terminate/monitor) | None (Gateway manages itself) |
| Auth management | 5 auth types (OAuth, API key, Bedrock, Vertex, Foundry) | Upstream provider credentials |
| Shared artifacts | CLAUDE.md sync | N/A |
| Channel breadth | Terminal only | 23+ channels via Gateway |
| MCP | Full (client + server) | Via separate config |
