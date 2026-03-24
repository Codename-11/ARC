# ARC — Agent Runtime Control

[![npm version](https://img.shields.io/npm/v/arccli.svg)](https://www.npmjs.com/package/arccli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/arccli.svg)](https://nodejs.org)

Unified profile and environment manager for agent CLIs. Maintains isolated config directories per profile and injects the right credentials and environment before launching any agent tool.

> **Tool-agnostic by design.** Claude Code is the baseline today — Gemini CLI, Codex CLI, and others are first-class citizens going forward.

<p align="center">
  <img src="assets/multicc.png" alt="ARC" width="700">
</p>

<p align="center">
  <a href="./docs/getting-started.md">Install</a> ·
  <a href="./docs/profiles.md">Profiles</a> ·
  <a href="./docs/authentication.md">Auth</a> ·
  <a href="./docs/shell-integration.md">Shell</a> ·
  <a href="./docs/index.md">Docs</a>
</p>

## Features

| Feature | Description |
|---------|-------------|
| **Named Profiles** | Create and switch between multiple accounts and tool configs |
| **Tool-Agnostic** | Profiles target any agent binary: `claude`, `gemini`, `codex`, or custom |
| **Auth Flexibility** | OAuth, API key, AWS Bedrock, Google Vertex AI, and Foundry |
| **Secure Storage** | API keys stored in the OS keyring with plaintext fallback |
| **Shell Integration** | Wraps agent commands in bash, zsh, fish, and PowerShell |
| **Windows-First** | Local shim install, user PATH management, PowerShell support |
| **Env Isolation** | Auth env vars sanitized between profiles to prevent credential leaks |
| **Lifecycle CLI** | `setup`, `update`, `uninstall` managed from the same tool |

## Installation

### Bootstrap (recommended on Windows)

**PowerShell:**

```powershell
irm https://raw.githubusercontent.com/Codename-11/ARC/main/scripts/bootstrap.ps1 | iex
```

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/Codename-11/ARC/main/scripts/bootstrap.sh | bash
```

The bootstrap clones the repo into `~/.arc-install/repo`, installs dependencies, runs `arc setup`, and adds shell integration — all in one step. Open a new terminal and confirm with `arc --help`.

### npm

```bash
npm install -g arccli
arc setup              # Install shims and shell integration
```

See [Getting Started](./docs/getting-started.md) for requirements and platform notes.

## Quick Start

```bash
# Import your existing Claude Code config
arc profile import --name default

# Or create a new profile interactively
arc

# Create a profile for a specific tool
arc create claude-work --tool claude --auth-type oauth
arc create gemini-work --tool gemini --auth-type api-key

# Launch the agent tool for a profile
arc launch work

# Switch the active profile
arc use personal
```

Running `arc` with no arguments and no profiles opens the interactive onboarding wizard.

## Usage

### Profile management

```bash
arc create <name>                  # Create a profile (prompts for tool + auth)
arc list                           # List all profiles
arc use <name>                     # Switch active profile
arc profile show [name]            # Show profile details
arc profile delete <name>          # Delete a profile
arc profile import                 # Import existing tool config
```

### Session commands

```bash
arc launch [name]                  # Launch agent tool with profile
arc set-key [name]                 # Store an API key
arc status                         # Show status of all profiles
```

### Lifecycle

```bash
arc setup                          # Install shims, PATH, shell integration
arc update                         # Refresh shims and integration
arc uninstall                      # Remove shims, PATH, integration, and data
```

### Advanced

```bash
arc exec [name] -- <cmd>           # Run a command with profile environment
arc shell [name]                   # Open a subshell with profile environment
arc shell-init                     # Output shell integration code
arc prune                          # Remove all arc data
```

See [Advanced Usage](./docs/advanced.md) for details.

## Shell Integration

After `arc setup`, agent tool commands automatically use the active profile:

```bash
# bash / zsh
eval "$(arc shell-init)"

# fish
arc shell-init --shell fish | source

# PowerShell
arc shell-init --shell powershell | Out-String | Invoke-Expression
```

See [Shell Integration](./docs/shell-integration.md).

## Data Layout

```
~/.arc/
  config.json              # Profile registry and active profile
  profiles/
    <name>/                # Each profile is an isolated tool config dir
      .credentials.json    # OAuth tokens
      .api-key             # Plaintext API key fallback
      settings.json        # Tool settings
```

See [Configuration](./docs/configuration.md).

## Documentation

| Guide | |
|-------|-|
| [Getting Started](./docs/getting-started.md) | Install, requirements, first profile |
| [Profiles](./docs/profiles.md) | Create, switch, import, delete |
| [Authentication](./docs/authentication.md) | OAuth, API key, Bedrock, Vertex, Foundry |
| [Shell Integration](./docs/shell-integration.md) | Bash, zsh, fish, PowerShell |
| [Advanced Usage](./docs/advanced.md) | exec, subshell, env overrides, prune |
| [Configuration](./docs/configuration.md) | Data layout and config schema |
| [Development](./docs/development.md) | Build, test, contribute |
| [Troubleshooting](./docs/troubleshooting.md) | Common issues and fixes |

## Development

```bash
git clone https://github.com/Codename-11/ARC.git
cd ARC
pnpm install
pnpm build
pnpm cli -- --help         # Run built CLI (arc)
pnpm cli:dev -- --help     # Run from source
pnpm typecheck
```

See [Development](./docs/development.md) for the full guide.

## License

[MIT](LICENSE) — Copyright (c) 2025 fmdz387
