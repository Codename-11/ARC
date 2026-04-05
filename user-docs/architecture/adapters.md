# Adapters

Every agent runtime integrates with ARC through a common `RuntimeAdapter` interface. Integration depth varies by runtime — Claude Code gets the deepest hooks, while others get process-level wrapping. The core doesn't care.

## RuntimeAdapter Interface

```typescript
interface RuntimeAdapter {
  readonly name: string;
  readonly capabilities: AdapterCapabilities;

  // Lifecycle
  launch(profile: Profile, options: LaunchOptions): Promise<AgentProcess>;
  terminate(process: AgentProcess): Promise<void>;
  isRunning(process: AgentProcess): boolean;

  // Supervision hooks (called by core pipeline)
  preflight?(ctx: HookContext): Promise<PreflightResult>;
  postflight?(ctx: HookContext, response: AgentResponse): Promise<PostflightResult>;

  // Context injection (adapter-specific mechanism)
  injectContext?(process: AgentProcess, metadata: HookMetadata): Promise<void>;

  // Monitoring
  onOutput?(process: AgentProcess, handler: (data: OutputEvent) => void): void;
  getStatus?(process: AgentProcess): Promise<AgentStatus>;

  // Profile management
  applyProfile?(profile: Profile): Promise<void>;
  detectInstallation?(): Promise<ToolDetection>;
  importConfig?(toolPath: string): Promise<Partial<Profile>>;
}
```

## Capability Matrix

| Capability | Claude Code | Codex CLI | Gemini CLI | OpenClaw | Hermes | Generic |
|------------|:-----------:|:---------:|:----------:|:--------:|:------:|:-------:|
| **Hooks** | Yes | -- | -- | Yes | -- | -- |
| **SDK Control** | Yes | -- | -- | -- | -- | -- |
| **Plugin System** | Yes | -- | -- | Yes | -- | -- |
| **MCP Support** | Yes | Yes | Yes | -- | Yes | Yes |
| **JSON Output** | Yes | Yes | -- | -- | -- | -- |
| **Sandboxing** | -- | Yes | -- | -- | -- | -- |
| **Process Wrap** | Yes | Yes | Yes | -- | Yes | Yes |
| **Remote Support** | -- | -- | -- | -- | Yes | Yes |

## Claude Code Adapter <Badge type="tip" text="deepest integration" />

The richest adapter, with three integration modes available simultaneously:

### SDK Control Protocol

Bidirectional JSON over stdio. ARC spawns Claude Code via the SDK, then sends/receives control messages:

- `initialize` — register hooks, MCP servers, system prompt, agents
- `can_use_tool` / `set_permission_mode` — permission management
- `mcp_set_servers` — dynamic MCP server management
- `apply_flag_settings` — runtime config changes
- `hook_callback` — respond to hook events
- Full message stream for monitoring

### Plugin System

ARC registers as a Claude Code plugin:

```
arc-claude-plugin/
├── plugin.json        # Manifest
├── hooks/hooks.json   # All 27 event types
├── commands/          # Custom slash commands
└── agents/            # Custom agent types
```

### HTTP Hooks

For hooks that need to call back to ARC's supervision pipeline:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{ "type": "http", "url": "http://localhost:{{ARC_PORT}}/hooks/pre-tool-use" }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{ "type": "http", "url": "http://localhost:{{ARC_PORT}}/hooks/post-tool-use" }]
    }]
  }
}
```

**Hook capabilities:**

- `PreToolUse` — return `permissionDecision` (allow/deny/ask), `updatedInput`, `additionalContext`
- `PostToolUse` — return `additionalContext`, `updatedMCPToolOutput`
- `SessionStart` — inject `additionalContext`, set `watchPaths`
- `Stop` — final supervision pass, write traces
- All 27 events available for monitoring

## Codex CLI Adapter

Process wrapper with structured JSON output:

```typescript
const proc = spawn('codex', [
  '--json',
  '--full-stdout',
  '--approval-mode', profile.codex.approvalMode,
  '--model', profile.model,
  '--project-doc', arcInstructionsPath,
  prompt
], { env: profile.env });
```

**Integration points:**

- `instructions.md` management — ARC writes behavioral constraints per profile
- `~/.codex/config.yaml` management — model, approval mode, MCP servers
- MCP server — ARC exposes supervision tools that Codex can call
- JSON output stream — real-time monitoring and trace collection
- Sandbox enforcement — leverage OS-level sandboxing in `full-auto` mode

## Gemini CLI Adapter

Process wrapper with stdio capture:

**Integration points:**

- Process spawn with env-based auth (`GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`)
- `GEMINI.md` management — instructions file per profile
- stdio stream capture for monitoring
- MCP server connection for tool integration

## OpenClaw Adapter <Badge type="tip" text="native plugin" />

Unlike other adapters, OpenClaw runs ARC as a **native plugin** inside the Gateway process — no subprocess wrapping. The adapter registers directly with OpenClaw's lifecycle bus via `jiti` dynamic loading.

**Integration points:**

- `openclaw.plugin.json` — plugin manifest with config schema (`profileName`, `enforcementMode`)
- **Three lifecycle hooks** registered on the bus:
  - `before_prompt_build` — runs pre-message pipeline, injects `[ARC]` metadata lines into system prompt
  - `agent_end` — runs post-message pipeline, audit check, retry signal on low confidence
  - `session_end` — clears ephemeral hook state
- **Five supervision tools** registered as optional agent tools (`arc_expand_intent`, `arc_classify_risk`, `arc_derive_completion`, `arc_audit_completion`, `arc_explain_trace`)
- **No process lifecycle** — `launch()` throws (Gateway manages its own lifecycle), `terminate()` is a no-op
- **Auth** — uses upstream provider credentials (Anthropic, OpenAI, etc.), not its own

Since OpenClaw Gateway bridges 23+ messaging channels, ARC's full hook pipeline applies uniformly to messages from Telegram, Discord, Slack, WhatsApp, and all other connected channels.

::: tip
See the [OpenClaw integration guide](/guide/openclaw) for setup instructions and use cases.
:::

## Hermes Agent Adapter

Process wrapper with MCP bridge integration. Hermes is a Python-based agent framework by Nous Research with persistent memory, self-improving skills, and a multi-channel gateway.

**Integration points:**

- **Process wrap** — ARC spawns `hermes` CLI with profile-specific environment
- **MCP bridge (bidirectional):**
  - ARC as MCP server → Hermes consumes supervision tools via `mcp_servers` config
  - Hermes as MCP server (`hermes mcp serve`) → ARC profiles access conversations and approvals
- **Profile mapping** — ARC profiles map to `~/.hermes/profiles/<name>/` directories
- **Context file compatibility** — Hermes reads `CLAUDE.md` (priority 3), so ARC's shared layer sync works automatically
- **Auth** — API keys via `~/.hermes/.env` or ARC secret management
- **Terminal backends** — local, Docker (sandboxed), SSH, Modal, Daytona

Hermes' persistent memory (SQLite FTS5 + Honcho dialectic modeling) complements ARC's cross-profile shared memory, giving deep per-agent recall alongside broad cross-agent context.

::: tip
See the [Hermes Agent integration guide](/guide/hermes) for setup instructions and use cases.
:::

## Generic Adapter

Fallback for any runtime that speaks MCP or HTTP:

- **MCP adapter** — connect to any MCP-compatible server
- **HTTP adapter** — REST API-based agent communication

Use the generic adapter for custom or experimental runtimes.

## Three-Tier Permission Model

All adapters support ARC's three-tier permission model:

| Tier | Access Level | Use Case |
|------|-------------|----------|
| `coordinator` | Full tool access, can spawn sub-agents | Primary agent orchestrating work |
| `interactive` | Standard permissions, approval-gated | User-facing interactive sessions |
| `worker` | Degraded, no destructive ops or spawning | Background tasks, batch operations |

Permission evaluation follows **deny > ask > allow** precedence with audit logging. Worker tier blocks destructive operations: delete, spawn, deploy, push, force, reset, destroy.
