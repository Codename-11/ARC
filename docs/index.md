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

### Multi-Account Management

```bash
arc auth list                      # List authenticated accounts
arc auth add <provider>            # Add a new auth account
arc auth remove <name>             # Remove an auth account
arc auth switch <name>             # Switch active auth account
```

See [Advanced Usage](./advanced.md) for details.

### Task Management

```bash
arc tasks list                     # List tasks
arc tasks add <description>        # Add a task
arc tasks done <id>                # Mark a task complete
arc tasks clear                    # Clear completed tasks
```

### Memory System

```bash
arc memory list                    # List memories
arc memory search <query>          # Relevance search across memories
arc memory add <content>           # Manually add a memory
arc memory prune                   # Archive low-relevance memories
arc memory sync                    # Force sync to external targets
arc memory export                  # Export memories as JSON
```

### Skill Registry

```bash
arc skills list                    # List registered skills
arc skills add <name>              # Register a skill
arc skills remove <name>           # Remove a skill
arc skills info <name>             # Show skill details
```

### Session Continuity

```bash
arc sessions list                  # List saved sessions
arc sessions resume <id>           # Resume a session
arc sessions save [name]           # Save current session
arc sessions delete <id>           # Delete a session
```

### Web Dashboard

```bash
arc web                            # Open web dashboard
arc web --port <port>              # Specify port
```

### Telemetry

```bash
arc telemetry status               # Show telemetry status
arc telemetry enable               # Enable telemetry
arc telemetry disable              # Disable telemetry
```

### Remote Agents

```bash
arc remote list                    # List remote agents
arc remote connect <url>           # Connect to a remote agent
arc remote disconnect <name>       # Disconnect a remote agent
```

### Plugin System

```bash
arc plugins list                   # List installed plugins
arc plugins install <name>         # Install a plugin
arc plugins remove <name>          # Remove a plugin
arc plugins info <name>            # Show plugin details
```

### Cloud Sync

```bash
arc sync pull                      # Pull all data from cloud
arc sync push                      # Push local changes to cloud
arc sync status                    # Show sync state, last sync, conflicts
arc sync devices                   # List registered devices
```

### Dark Factory

```bash
arc factory run --spec <file>      # Start factory run
arc factory status [runId]         # Check run status
arc factory abort [runId]          # Abort run
arc factory list                   # List past runs
```

### Advanced

```bash
arc exec [name] -- <cmd>           # Run a command with profile environment
arc shell [name]                   # Open a subshell with profile environment
arc shell-init                     # Output shell integration code
arc prune                          # Remove all arc data
```
