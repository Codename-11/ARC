# CLI Commands

Complete reference for all `arc` CLI commands.

## Profiles

### `arc create <name>`

Create a new profile.

```bash
arc create <name> [--tool claude|gemini|codex] [--auth-type oauth|api-key|bedrock|vertex|foundry]
arc create staging --inherits base
```

| Flag | Default | Description |
|------|---------|-------------|
| `--tool` | `claude` | Agent tool binary |
| `--auth-type` | `oauth` | Authentication method |
| `--inherits` | -- | Base profile to inherit from |

### `arc list`

List all profiles with tool, auth type, and active status.

### `arc use <name>`

Switch the active profile.

### `arc profile show [name]`

Show profile details. Defaults to the active profile.

### `arc profile delete <name>`

Delete a profile and its config directory.

### `arc profile import`

Import an existing tool config into a new ARC profile.

```bash
arc profile import --name default
arc profile import --name work --from ~/.claude --tool claude
```

### `arc profile set-flags <name> <flags...>`

Set persistent launch flags for a profile. These flags are prepended on every `arc launch`.

```bash
arc profile set-flags work --dangerously-skip-permissions
arc profile set-flags work --model sonnet --verbose
arc profile set-flags work --clear    # remove all flags
```

### `arc import [name]`

Top-level shortcut to import detected tool configs into profiles.

```bash
arc import                # import Claude config as "default"
arc import work           # import as "work"
arc import --all          # import all detected tool configs
arc import --all --force  # overwrite existing profiles
```

### `arc which`

Show the resolved profile source — displays where the active profile comes from (env var, workspace, or config).

### `arc status`

Show all profiles with tool, auth method, and authentication state.

## Launch & Exec

### `arc launch [name]`

Launch the agent tool with the specified (or active) profile.

```bash
arc launch
arc launch work
arc launch work -- --model opus
arc launch -- --model sonnet
```

All flags after `--` are forwarded to the tool.

### `arc exec <name> -- <command>`

Run any command with a profile's environment injected.

```bash
arc exec work -- claude --help
arc exec work -- env | grep CLAUDE
arc exec aws -- aws sts get-caller-identity
```

### `arc shell [name]`

Open a subshell with the profile's environment active.

## Dashboard

### `arc` / `arc dashboard`

Open the TUI dashboard.

### `arc web`

Open the web dashboard.

```bash
arc web [--port 3000] [--host localhost]
```

## Auth

### `arc set-key <profile>`

Set an API key for a profile. Prompts for the key interactively.

```bash
arc set-key work
arc set-key work --from-env ANTHROPIC_API_KEY
```

### `arc auth login <profile>`

Trigger OAuth login for a profile.

### `arc auth status`

Show auth status for all profiles.

### `arc auth refresh <profile>`

Check or force token refresh for an OAuth profile.

### `arc auth whoami [profile]`

Show the authenticated identity for a profile.

## Config

### `arc config get [key]`

Show a config setting value, or all settings if no key is given.

```bash
arc config get              # show all settings
arc config get theme        # show a specific setting
```

### `arc config set <key> <value>`

Set a config value. Booleans use `true`/`false`, numbers are parsed automatically.

```bash
arc config set theme dark
arc config set telemetryEnabled false
```

## Sessions

### `arc sessions list`

List all sessions. Filter with `--status active|suspended|completed`.

### `arc sessions show <id>`

Show session details.

### `arc sessions resume [id]`

Resume a suspended session. Defaults to the most recent.

### `arc sessions complete <id>`

Mark a session as completed.

## Tasks

### `arc tasks create <title>`

Create a task.

```bash
arc tasks create "Implement login" --priority high --assignee work
```

### `arc tasks list`

List tasks. Filter with `--status`, `--priority`, `--assignee`.

### `arc tasks update <id>`

Update a task.

```bash
arc tasks update <id> --status completed
arc tasks update <id> --priority critical
```

### `arc tasks stop <id>`

Stop a running task.

### `arc tasks cron create <title>`

Schedule a recurring task.

```bash
arc tasks cron create "Nightly lint" --schedule "0 2 * * *"
```

### `arc tasks output <id> [text]`

View task output. If `text` is provided, appends it to the task's output.

```bash
arc tasks output abc123              # view output
arc tasks output abc123 "Step 2 done"  # append output
```

### `arc tasks cron list` / `arc tasks cron delete <id>`

List or delete cron schedules.

## Memory

### `arc memory search <query>`

Search persistent memory by keyword.

### `arc memory list`

List memory entries. Filter with `--scope`, `--type`.

### `arc memory stats`

Show memory score distribution.

### `arc memory prune`

Remove low-relevance memories.

```bash
arc memory prune --threshold 0.1
```

## Skills

### `arc skills list`

List loaded skills.

### `arc skills load <dir>`

Load skills from a directory.

### `arc skills info <name>`

Show skill details.

## MCP

### `arc mcp serve`

Start ARC as an MCP server.

```bash
arc mcp serve                              # stdio transport
arc mcp serve --transport http             # HTTP transport
arc mcp serve --transport http --port 3100 --require-auth --auth-token <token>
```

### `arc mcp connect <uri>`

Connect to an external MCP server.

### `arc mcp list`

List connected MCP servers.

### `arc mcp disconnect <name>`

Disconnect from an MCP server.

## Secrets

### `arc secret set <key> <value>`

Store an encrypted secret.

### `arc secret get <key>`

Retrieve a secret.

### `arc secret list`

List secret keys.

### `arc secret delete <key>`

Delete a secret.

## Shared Layer

### `arc shared enable [name]`

Enable the shared layer for a profile.

```bash
arc shared enable work --memory --claude-md --projects
```

### `arc shared disable [name]`

Disable the shared layer.

### `arc shared sync`

Re-apply shared config to all enabled profiles.

```bash
arc shared sync [--all] [--name <profile>]
```

### `arc shared status`

Show shared layer contents and enabled profiles.

### `arc shared source [name]`

Set (or clear) a profile as the sync source for the shared layer. When set, `arc shared sync` auto-pulls from this profile first.

```bash
arc shared source work        # set work as sync source
arc shared source --clear     # remove the sync source
```

### `arc shared pull [name]`

Pull a profile's MCPs, commands, and CLAUDE.md into the shared layer. Defaults to the active profile.

```bash
arc shared pull           # pull from active profile
arc shared pull work      # pull from work profile
```

### `arc shared show`

Print raw shared `settings.json`.

## Swap <Badge type="warning" text="experimental" />

### `arc swap capture <name>`

Capture current tool credentials.

```bash
arc swap capture work --tool claude
```

### `arc swap to <name>`

Swap to a captured credential set.

### `arc swap from-profile <name>`

Bridge profile credentials to the tool's canonical directory.

### `arc swap status` / `arc swap list` / `arc swap delete <name>`

Manage swap snapshots.

## Telemetry & Logs

### `arc telemetry status`

Show telemetry configuration and storage size.

### `arc telemetry traces`

View execution traces. Filter with `--limit`, `--session`.

### `arc logs`

View structured logs.

```bash
arc logs [--level error] [--limit 20] [--component hooks] [--profile work] [--json]
```

## Factory

### `arc factory start <spec>`

Start a Dark Factory run.

### `arc factory status`

Show factory state, current wave, and progress.

### `arc factory abort`

Halt factory execution at the next consensus gate.

## Sync

### `arc sync configure`

Configure sync provider.

```bash
arc sync configure --provider filesystem --path /mnt/nas/arc-sync
```

### `arc sync push` / `arc sync pull`

Push or pull configuration.

### `arc sync status`

Show sync state and last sync time.

## Plugins

### `arc plugins list`

List installed plugins.

### `arc plugins install <path>`

Install a plugin.

### `arc plugins enable <name>` / `arc plugins disable <name>`

Enable or disable a plugin.

### `arc plugins uninstall <name>`

Remove a plugin.

## Remote Agents

### `arc remote add <name> <endpoint>`

Register a remote agent.

```bash
arc remote add staging https://staging.example.com --transport http
arc remote add build-box ssh://ci@10.0.1.50 --transport ssh --profile worker
```

### `arc remote list`

List registered remote agents.

### `arc remote check [name]`

Health-check remote agents.

### `arc remote remove <name>`

Unregister a remote agent.

## Lifecycle

### `arc setup`

Install shims, configure PATH, and add shell integration.

```bash
arc setup [--shell bash|zsh|fish|powershell] [--no-shell]
```

### `arc update`

Refresh shims and self-update.

### `arc doctor`

Run diagnostics (tool installations, PATH, shell integration, keyring).

### `arc health`

Run fast runtime readiness checks. Lighter than `arc doctor` — checks that ARC can start and profiles are loadable.

```bash
arc health
arc health --json    # machine-readable output
```

### `arc shell-init`

Output shell integration code for your shell. Used by `arc setup` internally, but can be called directly.

```bash
arc shell-init --shell bash
arc shell-init --shell zsh
arc shell-init --shell fish
arc shell-init --shell powershell
```

### `arc prune`

Remove all ARC data (`~/.arc/`). Destructive — requires confirmation.

```bash
arc prune [--force]
```

### `arc uninstall`

Remove shims, PATH entries, and shell integration.

```bash
arc uninstall [--force]
```
