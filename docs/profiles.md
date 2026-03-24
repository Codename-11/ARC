# Profiles

A profile is an isolated config directory (`~/.arc/profiles/<name>/`) paired with a target agent tool and auth method. Each profile has its own credentials, settings, and API key.

## Commands

### Create

```bash
arc create <name>
arc create <name> --tool claude --auth-type oauth
arc create <name> --tool gemini --auth-type api-key
arc create <name> --tool codex  --auth-type api-key
```

`--tool` defaults to `claude` if omitted. Profile names must be alphanumeric with hyphens, starting with a letter or number, at most 32 characters.

See [Authentication](./authentication.md) for all `--auth-type` values.

### List

```bash
arc list
```

Displays all profiles with their tool, auth type, and active status.

### Switch active profile

```bash
arc use <name>
```

Sets the default profile used by `arc launch` and the shell wrapper.

### Show details

```bash
arc profile show           # Active profile
arc profile show <name>    # Named profile
```

Output includes tool, auth type, config directory, and env overrides.

### Delete

```bash
arc profile delete <name>
```

Removes the profile entry from the registry and deletes the config directory.

### Import

```bash
arc profile import
arc profile import --name default
arc profile import --name claude-work --from ~/.claude --tool claude
arc profile import --name gemini-work --from ~/.gemini --tool gemini
```

Copies an existing tool config directory into a new ARC profile. The `--tool` flag defaults to `claude` and controls which tool-specific files are handled (e.g. `.claude.json` is only copied for Claude profiles).

## Status

```bash
arc status
```

Shows all profiles with their tool, auth method, and authentication state (authenticated, expired, missing credentials).

## Data Layout

```
~/.arc/
  config.json              # Profile registry and active profile name
  profiles/
    <name>/                # Tool config dir (set as CLAUDE_CONFIG_DIR, etc.)
      .credentials.json    # OAuth tokens
      .api-key             # Plaintext API key fallback
      settings.json        # Tool settings
```

See [Configuration](./configuration.md) for the full schema.
