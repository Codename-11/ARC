# Configuration

## Data Layout

```
~/.arc/
├── config.json              # Profile registry and active profile
├── update-check.json        # Cached latest version from npm (4h TTL)
├── profiles/
│   └── <name>/              # Tool config dir for this profile
│       ├── .credentials.json    # OAuth tokens (Claude)
│       ├── oauth_creds.json     # OAuth tokens (Gemini)
│       ├── auth.json            # OAuth tokens (Codex)
│       ├── .api-key             # Plaintext API key fallback
│       ├── settings.json        # Tool settings
│       └── .arc-shared.json     # Shared layer sync manifest
├── shared/                  # Shared layer (synced across enabled profiles)
│   ├── settings.json            # Shared MCP servers (mcpServers key)
│   ├── commands/                # Shared command files
│   ├── CLAUDE.md                # Shared instructions
│   ├── memory/                  # Shared memory (linked via junction/symlink)
│   └── projects/                # Shared projects (linked via junction/symlink)
├── credentials/             # [experimental] Hot-swap snapshots
│   ├── swap-manifest.json
│   └── <name>/
├── memory/                  # Persistent memory store
├── tasks/
│   └── tasks.json           # Task store
├── sessions.json            # Session store
├── plugins/
│   └── installed.json       # Plugin registry
├── remote-agents.json       # Remote agent registry
├── skills/                  # Skill definitions
├── logs/
│   └── structured.jsonl     # Structured log
└── traces/                  # OpenTelemetry JSONL traces
```

## config.json

The central configuration file. Contains the profile registry, active profile, and display settings.

```json
{
  "version": 1,
  "activeProfile": "work",
  "profileOrder": ["work", "personal", "gemini-work"],
  "profiles": {
    "work": {
      "tool": "claude",
      "authType": "oauth",
      "configDir": "/home/user/.arc/profiles/work",
      "description": "Work Claude account",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "useShared": true,
      "useSharedMemory": true,
      "launchArgs": ["--model", "sonnet"]
    },
    "gemini-work": {
      "tool": "gemini",
      "authType": "api-key",
      "configDir": "/home/user/.arc/profiles/gemini-work",
      "createdAt": "2025-01-01T00:00:00.000Z"
    },
    "personal": {
      "tool": "claude",
      "authType": "api-key",
      "configDir": "/home/user/.arc/profiles/personal",
      "apiKeyStorage": "keyring",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "envOverrides": {
        "ANTHROPIC_BASE_URL": "https://api.example.com"
      }
    }
  }
}
```

### Profile Fields

| Field | Type | Description |
|-------|------|-------------|
| `tool` | `string?` | Agent binary (`claude`, `gemini`, `codex`, ...). Defaults to `"claude"` |
| `authType` | `string` | One of `oauth`, `api-key`, `bedrock`, `vertex`, `foundry` |
| `configDir` | `string` | Absolute path to the profile's tool config directory |
| `description` | `string?` | Optional human-readable label |
| `createdAt` | `string` | ISO 8601 creation timestamp |
| `inherits` | `string?` | Name of a base profile to inherit from |
| `apiKeyStorage` | `"keyring" \| "file"?` | Where API keys are stored. Defaults to keyring with file fallback |
| `envOverrides` | `object?` | Extra env vars injected on launch |
| `useShared` | `boolean?` | Whether this profile inherits from `~/.arc/shared/` |
| `useSharedMemory` | `boolean?` | Whether `memory/` is linked to `shared/memory/` |
| `useSharedProjects` | `boolean?` | Whether `projects/` is linked to `shared/projects/` |
| `launchArgs` | `string[]?` | Default flags passed to the agent tool on every launch |
| `enforcement` | `"off" \| "log" \| "advise" \| "enforce"?` | Hook enforcement mode for this profile. Defaults to `"log"`. See [Hooks & Supervision](/features/hooks) |
| `hooks` | `object?` | Per-hook config overrides (`{ "hook-name": { enabled, timeout } }`). See [Hook Configuration](/features/hooks#configuring-hooks-per-profile) |

## arc.json

Per-workspace configuration file. Place in the project root for automatic profile and adapter selection.

```json
{
  "profile": "work",
  "adapter": "claude-code",
  "hooks": {
    "enforcement": "warn"
  },
  "telemetry": {
    "exporter": "otlp",
    "endpoint": "http://localhost:4318/v1/traces",
    "sampleRate": 1.0
  }
}
```

When `arc launch` runs inside a directory containing `arc.json`, the workspace config is applied on top of the resolved profile.

### arc.json Fields

| Field | Type | Description |
|-------|------|-------------|
| `profile` | `string?` | Override active profile for this workspace |
| `adapter` | `string?` | Override adapter selection |
| `hooks.enforcement` | `string?` | Hook enforcement mode (`off`, `log`, `warn`, `enforce`) |
| `telemetry.exporter` | `string?` | Telemetry exporter (`console`, `jsonl`, `otlp`) |
| `telemetry.endpoint` | `string?` | OTLP collector endpoint |
| `telemetry.sampleRate` | `number?` | Trace sample rate (0.0 - 1.0) |

## Profile Config Directory

Each profile's `configDir` is a standard agent tool config directory. ARC sets `CLAUDE_CONFIG_DIR` (or the equivalent env var for other tools) before launching.

| File | Written By | Purpose |
|------|-----------|---------|
| `.credentials.json` | Claude Code | OAuth tokens |
| `oauth_creds.json` | Gemini CLI | OAuth tokens |
| `auth.json` | Codex CLI | OAuth tokens |
| `settings.json` | Agent tool / user | Tool settings (MCP servers, etc.) |
| `.api-key` | ARC | Plaintext API key fallback |
| `.arc-shared.json` | ARC | Shared layer sync manifest |

## API Key Storage

API keys are stored via [`@napi-rs/keyring`](https://github.com/nicolo-ribaudo/napi-rs-keyring):

- **Service name**: `arc`
- **Account**: `<profile-name>`

If the native keyring is unavailable (missing build tools, headless environment), ARC falls back to `~/.arc/profiles/<name>/.api-key`.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ARC_DIR` | Override the ARC data directory (default: `~/.arc`) |
| `ARC_PROFILE` | Override the active profile for a single invocation |
| `ARC_LOCAL_BIN_DIR` | Override the local shim install directory (default: `~/.local/bin`) |
| `ARC_INSTALL_DIR` | Override the bootstrap install root (default: `~/.arc-install`) |

## Auth Environment Variables

These are set by ARC when launching a profile and cleared before each launch to prevent leakage:

| Variable | Set When |
|----------|----------|
| `CLAUDE_CONFIG_DIR` | Always (Claude profiles) |
| `CLAUDE_CODE_USE_BEDROCK` | `authType: "bedrock"` |
| `CLAUDE_CODE_USE_VERTEX` | `authType: "vertex"` |
| `CLAUDE_CODE_USE_FOUNDRY` | `authType: "foundry"` |
| `ANTHROPIC_API_KEY` | `authType: "api-key"` (Claude) |
| `GOOGLE_API_KEY` | `authType: "api-key"` (Gemini) |
| `AWS_ACCESS_KEY_ID` | `authType: "bedrock"` (if in envOverrides) |
| `AWS_SECRET_ACCESS_KEY` | `authType: "bedrock"` (if in envOverrides) |
| `AWS_REGION` | `authType: "bedrock"` (if in envOverrides) |
