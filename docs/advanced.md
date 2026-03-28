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

Hot-swap lets you switch between authenticated accounts on the **same tool** without changing MCPs, settings, or session history. Instead of isolated profile directories, it swaps only the credential files in the tool's canonical config directory (e.g. `~/.claude/`).

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
```

This copies the credential files from `~/.claude/` into `~/.arc/credentials/<name>/`.

### Swap between accounts

```bash
arc swap to work       # Swap credentials to the "work" account
arc swap to personal   # Swap back to "personal"
```

The current account's credentials are automatically saved before restoring the target. MCPs, settings, and local session history are preserved — only the auth credentials change.

### List and delete

```bash
arc swap list          # Show all captured account snapshots
arc swap delete work   # Remove a snapshot (can't delete the active one)
```

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
```

### Safety

- `arc swap to` requires confirmation (`[y/N]`) unless `--force` is passed
- If the restore step fails, credentials are rolled back to their previous state
- The swap manifest is updated only after a successful swap
