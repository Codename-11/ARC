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

| Capability | Claude Code | Codex CLI | Gemini CLI | OpenClaw | Generic |
|------------|:-----------:|:---------:|:----------:|:--------:|:-------:|
| **Hooks** | Yes | -- | -- | Yes | -- |
| **SDK Control** | Yes | -- | -- | -- | -- |
| **Plugin System** | Yes | -- | -- | -- | -- |
| **MCP Support** | Yes | Yes | Yes | -- | Yes |
| **JSON Output** | Yes | Yes | -- | -- | -- |
| **Sandboxing** | -- | Yes | -- | -- | -- |
| **Process Wrap** | Yes | Yes | Yes | Yes | Yes |
| **Remote Support** | -- | -- | -- | -- | Yes |

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

## OpenClaw Adapter

Native plugin integration:

**Integration points:**

- `openclaw.plugin.json` manifest
- Three lifecycle hooks via the hook bus
- Chat middleware injection
- Session bridge for state synchronization

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
