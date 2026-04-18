# Profiles

A profile is an isolated config directory (`~/.arc/profiles/<name>/`) paired with a target agent tool and auth method. Each profile has its own credentials, settings, and environment.

## Create

```bash
arc create <name>
arc create <name> --tool claude --auth-type oauth
arc create <name> --tool gemini --auth-type api-key
arc create <name> --tool codex  --auth-type api-key
```

`--tool` defaults to `claude` if omitted. Profile names must be alphanumeric with hyphens, starting with a letter or number, at most 32 characters.

See [Authentication](/guide/authentication) for all `--auth-type` values.

## List

```bash
arc list
```

Displays all profiles with their tool, auth type, and active status.

## Switch Active Profile

```bash
arc use <name>
```

Sets the default profile used by `arc launch` and the shell wrapper.

## Show Details

```bash
arc profile show           # Active profile
arc profile show <name>    # Named profile
```

Output includes tool, auth type, config directory, and env overrides.

## Delete

```bash
arc profile delete <name>
```

Removes the profile entry from the registry and deletes the config directory.

## Import

```bash
arc profile import
arc profile import --name default
arc profile import --name claude-work --from ~/.claude --tool claude
arc profile import --name gemini-work --from ~/.gemini --tool gemini
```

Copies an existing tool config directory into a new ARC profile. The `--tool` flag defaults to `claude` and controls which tool-specific files are handled.

## Profile Inheritance

Profiles can inherit from a base profile using the `inherits` field. The resolved profile merges the base config with the child's overrides:

```bash
# Base profile with shared settings
arc create base --tool claude --auth-type oauth

# Child profile that inherits and overrides
arc create staging --inherits base
```

When a profile with `inherits` is launched, ARC runs `resolveProfile()` to merge:
1. Base profile settings (tool, auth, env, launch args)
2. Child profile overrides (anything explicitly set)

## Launch Modes

Each profile can run its underlying tool in one of two modes, selectable per-profile or per-launch.

### Native (default)

Full TTY handoff. ARC spawns the tool with inherited stdio and exits, letting the tool paint its own TUI — Claude's `statusLine`, Gemini's ANSI chrome, Codex's REPL, etc. This is the right mode for daily interactive work.

```bash
arc launch work              # uses profile's launchMode (default: native)
arc launch work --native     # force native mode for this launch
```

In native mode ARC does no process supervision, no stdout capture, and no stream parsing. You get the tool's native experience; ARC just handled env isolation, credentials, and hook pre-launch checks.

### Worker

Run the tool under ARC supervision via the adapter's managed lifecycle. Stdout is captured and parsed so ARC can feed orchestrators (roundtable, PLAN/EXEC/VERIFY pipelines, dashboard chat). This **suppresses the tool's native TUI chrome** — it's meant for programmatic use, not direct interactive sessions.

```bash
arc launch work --worker     # one-off worker mode
```

To make worker mode the default for a profile, either set `launchMode: "worker"` in `~/.arc/config.json` or press `m` on the profile in the TUI Profiles view to toggle.

### When to use each

| Scenario | Mode |
|---|---|
| Daily coding with Claude / Gemini / Codex | **native** |
| Running a roundtable or multi-agent pipeline | **worker** (orchestrator forces this) |
| Dashboard AI chat / programmatic prompts | **worker** |
| CI / headless automation | **worker** |
| Debugging the tool's own TUI (statusLine, theming) | **native** |

### Resolution order

1. `opts.launchMode` passed by an orchestrator (always wins)
2. `--native` / `--worker` CLI flag
3. `profile.launchMode` in `~/.arc/config.json`
4. Default: `native`

## Workspace Selection

ARC supports per-repository profile auto-selection via `arc.json` in the project root:

```json
{
  "profile": "work",
  "adapter": "claude-code",
  "hooks": {
    "enforcement": "warn"
  }
}
```

When you run `arc launch` inside a directory containing `arc.json`, the workspace config is applied on top of the active profile. See [Configuration](/reference/configuration) for the full schema.

## Profile Resolution Order

```bash
arc which                  # Show the resolved profile source
```

Resolution order:

1. `ARC_PROFILE` env var (if set)
2. Workspace `arc.json` (if present in cwd or parent)
3. Active profile in `~/.arc/config.json`

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
      .arc-shared.json     # Shared layer sync manifest
```

See [Configuration](/reference/configuration) for the full schema.
