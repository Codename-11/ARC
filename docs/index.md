# ARC Documentation

**ARC — Agent Runtime Control.** Unified profile and environment manager for agent CLIs. Maintains isolated config directories per profile and injects the right credentials before launching any agent tool.

> Claude Code is the baseline today. Gemini CLI, Codex CLI, and others are supported via the `--tool` flag.

## Guides

| Guide | Description |
|-------|-------------|
| [Getting Started](./getting-started.md) | Install, requirements, and first profile |
| [Profiles](./profiles.md) | Create, switch, import, and delete profiles |
| [Authentication](./authentication.md) | OAuth, API key, Bedrock, Vertex AI, and Foundry |
| [Shell Integration](./shell-integration.md) | Bash, zsh, fish, and PowerShell setup |
| [Advanced Usage](./advanced.md) | Shared layer, credential hot-swap, exec, subshell, and prune |
| [Configuration](./configuration.md) | Data layout and config schema |
| [Development](./development.md) | Build, test, and contribute |
| [Troubleshooting](./troubleshooting.md) | Common issues and fixes |

## Quick Reference

### Profiles

```bash
arc create <name>                  # Create a profile
arc list                           # List profiles
arc use <name>                     # Switch active profile
arc profile show [name]            # Show profile details
arc profile delete <name>          # Delete a profile
arc profile import [--name <n>]    # Import existing tool config
```

### Dashboard

```bash
arc                                # Open TUI dashboard (or onboarding wizard)
arc dashboard                      # Same — explicit command
```

#### TUI Views

| View | Sidebar key | Description |
|------|-------------|-------------|
| Dash | default | ASCII logo, status overview, GitHub link, quick start |
| Work | ↓ | Workspace — shell commands + launch queue |
| Profiles | ↓ | Manage profiles (s switch, i info, d delete, h sync, shift+h push, f flags) |
| Doctor | ↓ | Diagnostics with inline repair hints (install, re-auth, PATH/shell fixes) |
| Settings | ↓ | Config, preferences (toggleable), shared layer, hot-swap accounts |
| Guide | ↓ | In-app documentation — profiles, shared layer, hot-swap, data layout |

On first run (no profiles), a fullscreen **onboarding wizard** launches instead of the dashboard. It auto-detects installed tool configs and offers import or stepped profile creation.

#### TUI Shortcuts

| Key | Scope | Action |
|-----|-------|--------|
| Ctrl+P | global | Command palette |
| Ctrl+T | global | Toggle theme |
| Ctrl+Q | global | Quit |
| Tab | global | Switch sidebar / content focus |
| c | sidebar or profiles | Create profile |
| u | sidebar (dash) | Check for updates |
| i | profiles | Profile info overlay |
| shift+h | profiles | Push config to shared layer |
| shift+s | profiles | Toggle sync source |
| f | profiles | Edit launch flags |
| ? | sidebar | Help overlay |
| q / t | sidebar | Quit / toggle theme |

#### Workspace Commands

Slash commands: `/launch`, `/switch`, `/status`, `/dash`, `/profiles`, `/doctor`, `/settings`, `/help`, `/create`, `/clear`

Bare text (no `/` prefix) runs as a **shell command** with the active profile's environment.

### Credential Hot-Swap (Experimental)

```bash
arc swap capture <name> --tool claude  # Capture current credentials
arc swap to <name>                     # Swap to another account
arc swap list                          # List captured accounts
arc swap delete <name>                 # Remove a snapshot
```

See [Advanced Usage](./advanced.md#credential-hot-swap-experimental) for details.

### Session

```bash
arc launch [name]                  # Launch agent tool with profile
arc set-key [name]                 # Store an API key
arc status                         # Show status of all profiles
arc doctor                         # Run diagnostics
```

### Shared Layer

```bash
arc shared status                  # Show shared layer contents and sync state
arc shared pull [name]             # Pull profile config into shared layer
arc shared source [name]           # Set a profile as the sync source
arc shared enable [name]           # Enable shared layer for a profile
arc shared disable [name]          # Disable shared layer for a profile
arc shared sync                    # Re-apply shared layer to enabled profiles
arc shared show                    # Print shared settings.json
```

### Profile Configuration

```bash
arc profile set-flags <name> <flags...>  # Set persistent launch flags
arc profile set-flags <name> --clear     # Clear launch flags
arc config set <key> <value>             # Set a preference (e.g. confirmLaunch true)
arc config get [key]                     # View settings
```

### Lifecycle

```bash
arc setup                          # Install shims, PATH, shell integration
arc update                         # Refresh shims and integration
arc uninstall                      # Remove shims, PATH, integration
```

### Advanced

```bash
arc exec [name] -- <cmd>           # Run a command with profile environment
arc shell [name]                   # Open a subshell with profile environment
arc shell-init                     # Output shell integration code
arc prune                          # Remove all arc data
```
