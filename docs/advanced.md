# Advanced Usage

## Shared Layer

The shared layer lets you define MCP servers, commands, CLAUDE.md content, memory, and projects once and sync them across multiple profiles. Shared items live in `~/.arc/shared/`:

```
~/.arc/shared/
  settings.json      # Shared MCP servers (mcpServers key)
  commands/           # Shared command files (copied into profiles)
  CLAUDE.md           # Shared instructions (prepended to profile CLAUDE.md)
  memory/             # Shared memory directory (linked via junction/symlink)
  projects/           # Shared projects directory (linked via junction/symlink)
```

### Enable the shared layer

```bash
# Enable for the active profile
arc shared enable

# Enable for a specific profile
arc shared enable work

# Enable with shared memory and CLAUDE.md
arc shared enable work --memory --claude-md

# Enable with shared projects
arc shared enable --projects
```

Options:
- `--memory` — Link the profile's `memory/` directory to `shared/memory/` (Windows junction / Unix symlink)
- `--projects` — Link the profile's `projects/` directory to `shared/projects/`
- `--claude-md` — Prepend `shared/CLAUDE.md` content into the profile's CLAUDE.md (wrapped in sentinel markers for clean updates)

### Disable the shared layer

```bash
arc shared disable [name]

# Only unlink memory
arc shared disable --memory

# Only unlink projects
arc shared disable --projects
```

Disabling removes synced MCP keys and commands from the profile, restores plain directories from junctions/symlinks, and strips the shared CLAUDE.md block.

### Sync and status

```bash
# Re-apply shared layer to enabled profiles
arc shared sync
arc shared sync --all
arc shared sync --name work

# Show what's in the shared layer and which profiles are enabled
arc shared status

# Print the raw shared settings.json
arc shared show
```

Re-syncing is safe to run repeatedly — it removes stale entries, updates changed items, and preserves profile-specific settings that conflict with shared keys.

### How syncing works

- **MCP servers**: Shared keys are merged into the profile's `settings.json`. Profile-specific keys win on conflict. Previously-synced keys that are removed from shared are cleaned up.
- **Commands**: Files from `shared/commands/` are copied into the profile. Existing profile-specific files are not overwritten. Previously-synced files removed from shared are cleaned up.
- **CLAUDE.md**: Shared content is wrapped in `<!-- arc:shared:start -->` / `<!-- arc:shared:end -->` sentinel markers and prepended to the profile's CLAUDE.md. Re-syncing replaces the block cleanly.
- **Memory / Projects**: Directories are linked via Windows junction or Unix symlink. If the profile already has files in these directories, they are merged into the shared target before linking.

A manifest file (`.arc-shared.json`) is written into the profile directory to track what was synced, enabling clean reversal and re-sync.

---

## exec — Run a command with profile environment

Run any command with a profile's environment variables injected, without launching the agent tool:

```bash
arc exec <name> -- <command> [args...]

# Examples
arc exec work -- claude --help
arc exec work -- env | grep CLAUDE
arc exec aws -- aws sts get-caller-identity
arc exec gemini-work -- gemini --version
```

Useful for scripts, CI pipelines, or any tool that reads auth env vars.

## shell — Open a subshell with profile environment

Opens a new shell with the profile's environment already active:

```bash
arc shell [name]
```

If `name` is omitted, the active profile is used. Exit normally (`exit` or `Ctrl+D`) to return.

## launch — Launch agent tool

```bash
arc launch [name]
arc launch [name] -- <args...>
```

Launches the agent tool configured for the profile (`profile.tool`) with `CLAUDE_CONFIG_DIR` (or equivalent) set to the profile's directory. If `name` is omitted, the active profile is used.

All flags after the profile name (or after `--`) are forwarded to the tool:

```bash
arc launch work --model sonnet
arc launch work -p "explain this code"
arc launch -- --model sonnet        # active profile, pass flags
```

## prune — Remove all arc data

```bash
arc prune
arc prune --force
```

Removes the entire `~/.arc/` directory and clears all keyring entries. This is destructive and cannot be undone. Requires confirmation unless `--force` is passed.

## Env overrides

Profiles support per-profile environment variable overrides stored in `~/.arc/config.json`. These are injected alongside standard auth env vars on every launch.

Example use cases:
- Point a profile at a custom API base URL
- Set `AWS_PROFILE` or `AWS_REGION` for a Bedrock profile
- Pass `ANTHROPIC_VERTEX_PROJECT_ID` for Vertex AI profiles

Overrides are stored in the profile's `envOverrides` field in `config.json`.

## Scripting with ARC_PROFILE

Set `ARC_PROFILE` to override which profile is used without modifying `config.json`:

```bash
ARC_PROFILE=work claude --help
ARC_PROFILE=gemini-work gemini --version
```

This works with both the shell wrapper and `arc launch`.

## Lifecycle commands

```bash
arc setup                  # Install shims, PATH, shell integration
arc update                 # Refresh shims, PATH, and integration
arc uninstall              # Remove shims, PATH, integration (interactive)
arc uninstall --force      # Remove without prompting
```

Or via pnpm (from a repo checkout):

```bash
pnpm uninstall:local        # Remove shims + PATH only (keeps ~/.arc/ config)
pnpm teardown               # Full teardown (keyring, ~/.arc/, shims, shell integration)
pnpm teardown:force         # Full teardown without confirmation
```

The full uninstall removes:
- API keys from the system keyring
- Config directory (`~/.arc/`)
- Global npm/pnpm link (if exists)
- Local shims in `~/.local/bin/`
- The `PATH` entry added for the shim directory (Windows only)
- Shell integration lines in your shell profile

Profile data in `~/.arc/` is **not** deleted by `uninstall:local` — use the full `uninstall` or `arc prune` for a complete removal.

## Credential Hot-Swap (Experimental)

> **Status:** Experimental. Default mode remains full profile isolation.

Hot-swap lets you switch between authenticated accounts on the **same tool** without changing MCPs, settings, or session history. Instead of isolated profile directories, it swaps only the credential files in the tool's canonical config directory (e.g. `~/.claude/`, `~/.gemini/`, `~/.codex/`). Supports Claude, Gemini, and Codex credential layouts.

### Hot-swap vs profile switch — what's the difference?

| | Profile switch (`arc use`) | Hot-swap (`arc swap to`) |
|---|---|---|
| **What changes** | Entire config directory | Only credential files |
| **MCPs, settings** | Each profile has its own | Shared — nothing changes |
| **Session history** | Per-profile (isolated) | Shared — stays in place |
| **Use case** | Different tools or different configs | Same tool, multiple accounts |
| **Claude Desktop** | Not affected | Auth changes for Desktop too |

**Profile switch** (`arc use work`) changes which isolated config directory is used. Each profile has its own MCPs, settings, and history. The tool reads from `~/.arc/profiles/<name>/`.

**Hot-swap** (`arc swap to work`) replaces only the credential file inside the tool's canonical directory (e.g. `~/.claude/.credentials.json`). Everything else — MCPs, settings, session history — stays exactly as-is. This also affects Claude Desktop and any other app reading from the same directory.

### When to use which

| Use case | Approach |
|----------|----------|
| Different tools (Claude, Gemini, Codex) | Profiles (`arc create`) |
| Different settings/MCPs per account | Profiles (`arc create`) |
| Same tool, multiple accounts, shared config | **Hot-swap** (`arc swap`) |

### Capture an account

First, authenticate with the tool normally (e.g. `claude` login). Then capture the credentials:

```bash
arc swap capture personal --tool claude
arc swap capture work --tool claude

# Multi-tool support — capture Gemini and Codex accounts the same way
arc swap capture gemini-work --tool gemini
arc swap capture codex-main --tool codex
```

This copies the credential files from the tool's canonical directory into `~/.arc/credentials/<name>/`.

### Swap between accounts

```bash
arc swap to work       # Swap credentials to the "work" account
arc swap to personal   # Swap back to "personal"
```

The current account's credentials are automatically saved before restoring the target. MCPs, settings, and local session history are preserved — only the auth credentials change.

### Bridge from profile to desktop

If you have a profile with working credentials and want to push them into the tool's canonical directory (e.g. for Claude Desktop), use `from-profile`:

```bash
arc swap from-profile work
```

This captures the profile's credentials as a swap snapshot and activates them in the canonical directory — bridging profile isolation with desktop app access.

### Status, list, and delete

```bash
arc swap status        # Show active account per tool and last swap time
arc swap list          # Show all captured account snapshots with metadata
arc swap delete work   # Remove a snapshot (can't delete the active one)
```

> `arc swap list` displays account metadata including subscription tier and tool type for each snapshot, making it easy to distinguish between free and pro accounts.

### TUI access

Open the hot-swap overlay via:
- **Command palette** (Ctrl+P) → "Swap Credentials"

The overlay lets you capture, swap, and delete accounts directly. Active account shows ●, with key hints for each action.

Captured accounts are also visible in the **Settings** view (read-only).

### Data layout

```
~/.arc/credentials/
  swap-manifest.json       # Tracks accounts and active per tool
  personal/                # Credential snapshot
    .credentials.json
  work/
    .credentials.json
  gemini-work/
    credentials.json
```

### Safety

- `arc swap to` requires confirmation (`[y/N]`) unless `--force` is passed
- If the restore step fails, credentials are rolled back to their previous state
- The swap manifest is updated only after a successful swap

---

## Multi-Account Management

ARC provides two complementary systems for working with multiple accounts. Use **profile isolation** for CLI tools where you want fully separate configs, and **credential hot-swap** for desktop apps where you want to share settings but switch auth.

### Profile isolation (CLI tools)

Each profile gets its own config directory, credentials, and settings. This is the primary approach for CLI agent tools:

```bash
# Create two Claude profiles with separate OAuth accounts
arc create work --tool claude --auth-type oauth
arc create personal --tool claude --auth-type oauth

# Login to each (opens browser OAuth flow)
arc auth login work
arc auth login personal

# Check which account is in each profile
arc auth status
arc auth whoami work

# Launch with a specific account
arc use work
arc launch
```

See [Profiles](./profiles.md) and [Authentication](./authentication.md) for full details on creation and auth setup.

### Credential hot-swap (desktop apps)

For desktop apps like Claude Desktop that read from a single canonical directory, hot-swap switches only the credential file while preserving everything else:

```bash
# Capture current desktop credentials
arc swap capture work-acct --tool claude

# Log in with another account in Claude Desktop, then capture it
arc swap capture personal-acct --tool claude

# Switch desktop apps between accounts
arc swap to work-acct
arc swap to personal-acct
arc swap status

# Or bridge from a profile to desktop
arc swap from-profile work
```

> See [Credential Hot-Swap](#credential-hot-swap-experimental) above for the full command reference.

---

## Task Management

Track work items across profiles. Tasks can be assigned to specific profiles and filtered by status, giving you a lightweight project board without leaving the terminal.

```bash
arc tasks create "Implement login page" --priority high --assignee work
arc tasks list
arc tasks list --status working
arc tasks update <id> --status completed
arc tasks stop <id>
```

Tasks are stored in `~/.arc/tasks.json`. Status values: `pending`, `working`, `completed`, `blocked`. Priority values: `low`, `medium`, `high`, `critical`.

> Tasks assigned to a profile are displayed in that profile's detail view in the TUI.

---

## Memory System

ARC's memory system stores observations, corrections, and learned preferences that persist across sessions. Memories are scoped and scored by relevance, allowing automatic pruning of low-value entries.

```bash
arc memory list
arc memory list --scope persistent --type correction
arc memory search "deployment process"
arc memory stats
arc memory prune --threshold 0.1
```

Scope values: `session` (cleared on exit), `persistent` (survives restarts), `shared` (synced across profiles via the shared layer). Type values: `observation`, `correction`, `preference`, `fact`.

> Memories with a relevance score below the prune threshold are removed. Use `arc memory stats` to see the score distribution before pruning.

---

## Skill Registry

Load and manage reusable skill definitions that extend agent capabilities. Skills are declarative descriptions of workflows, patterns, or domain knowledge that can be loaded from local files or shared directories.

```bash
arc skills list
arc skills load ~/.arc/skills/
arc skills info code-review
```

Skill files are plain JSON or YAML with a `name`, `description`, and `instructions` field. Loaded skills are registered globally and available to all profiles.

---

## Session Continuity

Suspend and resume agent sessions without losing context. When a session is suspended, ARC snapshots the session state so you can pick it up later — even after a reboot.

```bash
arc sessions list
arc sessions list --status suspended
arc sessions resume          # Resume last suspended session
arc sessions resume <id>
arc sessions complete <id>
```

Session status values: `active`, `suspended`, `completed`. Suspended sessions are stored in `~/.arc/sessions/` and include the working directory, profile, and conversation checkpoint.

> `arc sessions resume` with no arguments picks up the most recently suspended session.

---

## Web Dashboard

A browser-based dashboard for monitoring and managing ARC from any device on your network.

```bash
# Start the web dashboard
arc web
arc web --port 4000

# Development mode with hot-reload
pnpm dev:dashboard
```

The dashboard exposes a REST API at `/api/*` for programmatic access and a WebSocket endpoint for real-time updates (profile switches, task changes, session events). The UI uses ARC's Nothing-inspired design system with dark and light mode support.

> The dashboard binds to `localhost` by default. Pass `--host 0.0.0.0` to expose it on your network.

---

## Telemetry & Traces

Inspect execution traces and telemetry data for debugging agent interactions. Traces capture command invocations, tool calls, and timing information per session.

```bash
arc telemetry status
arc telemetry traces
arc telemetry traces --limit 100 --session <id>
```

Telemetry is local-only — nothing is sent externally. Trace data is stored in `~/.arc/traces/` and can be filtered by session, time range, or command type.

> Use `arc telemetry status` to check whether trace collection is enabled and see the current storage size.

---

## Remote Agents

Register and health-check remote agent endpoints. Remote agents are external services that speak the same protocol, accessible over HTTP or other transports.

```bash
arc remote add staging https://staging.example.com --transport http
arc remote list
arc remote check            # Health-check all registered remotes
arc remote check staging    # Health-check a single remote
arc remote remove staging
```

Remote entries are stored in `~/.arc/config.json` under the `remotes` key. Health checks verify connectivity and report the agent's version and capabilities.

---

## Plugin System

Extend ARC with third-party plugins. Plugins can add commands, views, and integrations that hook into the CLI and TUI lifecycle.

```bash
arc plugins list
arc plugins install ./my-plugin
arc plugins enable my-plugin
arc plugins disable my-plugin
arc plugins uninstall my-plugin
```

Plugins are loaded from `~/.arc/plugins/`. Each plugin must export a manifest with `name`, `version`, and an `activate` function. Disabled plugins remain installed but are not loaded at startup.

> Plugins run in the same process as ARC. Only install plugins you trust.

---

## Cloud Sync

Synchronize ARC configuration across machines using a configurable storage backend. Cloud sync pushes and pulls `config.json`, shared layer content, and task data.

```bash
arc sync status
arc sync configure --provider filesystem --path /mnt/nas/arc-sync
arc sync push
arc sync pull
```

The `filesystem` provider works with any mounted path (NAS, Dropbox folder, USB drive). Sync uses last-write-wins conflict resolution with a conflict log in `~/.arc/sync-conflicts.json`.

> Run `arc sync status` to see the last sync time and detect drift between local and remote state.

---

## Dark Factory

Autonomous execution mode for running multi-step task plans without manual intervention. Dark Factory decomposes a plan into waves of parallel tasks, each verified by independent verifier agents before proceeding.

```bash
arc factory status
arc factory abort
```

Execution follows a wave-based model: tasks within a wave run in parallel, and a consensus gate ensures all verifiers agree before advancing to the next wave. If any verifier rejects, the wave is retried or escalated.

> Dark Factory is designed for batch operations like codebase migrations, multi-file refactors, and test generation. Use `arc factory abort` to halt execution at the next consensus gate.
