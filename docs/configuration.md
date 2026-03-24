# Configuration

## Data layout

```
~/.arc/
  config.json              # Profile registry and active profile
  profiles/
    <name>/                # Tool config dir for this profile
      .credentials.json    # OAuth tokens (written by agent tool)
      .api-key             # Plaintext API key fallback
      settings.json        # Tool settings
```

## config.json schema

```json
{
  "version": 1,
  "activeProfile": "work",
  "profiles": {
    "work": {
      "name": "work",
      "tool": "claude",
      "authType": "oauth",
      "configDir": "/home/user/.arc/profiles/work",
      "description": "Work Claude account",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "envOverrides": {}
    },
    "gemini-work": {
      "name": "gemini-work",
      "tool": "gemini",
      "authType": "api-key",
      "configDir": "/home/user/.arc/profiles/gemini-work",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "envOverrides": {}
    },
    "personal": {
      "name": "personal",
      "tool": "claude",
      "authType": "api-key",
      "configDir": "/home/user/.arc/profiles/personal",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "envOverrides": {
        "ANTHROPIC_BASE_URL": "https://api.example.com"
      }
    }
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `activeProfile` | `string` | Name of the currently active profile |
| `profiles` | `object` | Map of profile name → profile object |
| `profiles.<name>.tool` | `string?` | Agent binary to launch (`claude`, `gemini`, `codex`, ...). Defaults to `"claude"` |
| `profiles.<name>.authType` | `string` | One of `oauth`, `api-key`, `bedrock`, `vertex`, `foundry` |
| `profiles.<name>.configDir` | `string` | Absolute path to the profile's tool config directory |
| `profiles.<name>.description` | `string?` | Optional human-readable label |
| `profiles.<name>.createdAt` | `string` | ISO 8601 creation timestamp |
| `profiles.<name>.envOverrides` | `object?` | Extra env vars injected on launch |

## Profile config directory

Each profile's `configDir` is a standard agent tool config directory. ARC sets `CLAUDE_CONFIG_DIR` (or the equivalent env var for other tools) before launching.

| File | Written by | Purpose |
|------|-----------|---------|
| `.credentials.json` | Agent tool | OAuth tokens |
| `settings.json` | Agent tool / user | Tool settings |
| `.api-key` | ARC | Plaintext API key fallback |

## API key storage

API keys are stored via [`@napi-rs/keyring`](https://github.com/nicolo-ribaudo/napi-rs-keyring) using the profile name as the account key.

- **Service name**: `arc`
- **Account**: `<profile-name>`

If the native keyring is unavailable (missing build tools, headless environment), ARC falls back to `~/.arc/profiles/<name>/.api-key`.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `ARC_DIR` | Override the ARC data directory (default: `~/.arc`) |
| `ARC_PROFILE` | Override the active profile for a single invocation |
| `ARC_LOCAL_BIN_DIR` | Override the local shim install directory (default: `~/.local/bin`) |
| `ARC_INSTALL_DIR` | Override the bootstrap install root (default: `~/.arc-install`) |
