<p align="center">
  <img src="assets/logo.svg" alt="ARC" width="120">
</p>

<h1 align="center">ARC — Agent Runtime Control</h1>

<p align="center">
  Unified profile and environment manager for agent CLIs.<br>
  Isolated configs, credentials, and environments — one tool to launch them all.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@axiom-labs/arc-cli"><img src="https://img.shields.io/npm/v/@axiom-labs/arc-cli.svg" alt="npm"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@axiom-labs/arc-cli.svg" alt="Node"></a>
  <a href="https://github.com/Codename-11/ARC/actions/workflows/ci.yml"><img src="https://github.com/Codename-11/ARC/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  <a href="./docs/getting-started.md">Install</a> ·
  <a href="./docs/profiles.md">Profiles</a> ·
  <a href="./docs/authentication.md">Auth</a> ·
  <a href="./docs/advanced.md#shared-layer">Shared Layer</a> ·
  <a href="./docs/shell-integration.md">Shell</a> ·
  <a href="./docs/index.md">Docs</a>
</p>

---

<p align="center">
  <img src="assets/screenshots/dash-dark.png" alt="ARC Dashboard" width="700">
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
| **Shared Layer** | Sync MCP servers, commands, memory, and CLAUDE.md across profiles |
| **TUI Dashboard** | Interactive terminal UI with profiles, diagnostics, settings, and guide |
| **Persistent Launch Flags** | Default flags per profile (e.g. `--dangerously-skip-permissions`) |
| **Credential Hot-Swap** | [experimental] Switch accounts without changing MCPs or settings |
| **Self-Update** | Built-in version check and `arc update` for self-updating |

## Installation

### Bootstrap (recommended on Windows)

**PowerShell:**

```powershell
irm https://raw.githubusercontent.com/Codename-11/ARC/master/scripts/bootstrap.ps1 | iex
```

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/Codename-11/ARC/master/scripts/bootstrap.sh | bash
```

### npm

```bash
npm install -g @axiom-labs/arc-cli
arc setup
arc
```

See [Getting Started](./docs/getting-started.md) for requirements and platform notes.

## Quick Start

```bash
arc                    # Open TUI — onboarding wizard on first run
```

The onboarding wizard auto-detects installed tools (Claude, Gemini, Codex) and offers to import their configs as profiles.

```bash
arc create work --tool claude --auth-type oauth
arc launch work
arc use personal
arc status
```

## Screenshots

| | |
|---|---|
| ![First Launch](assets/screenshots/first-launch.png) | ![Dashboard](assets/screenshots/dash.png) |
| First launch — onboarding wizard | Dashboard — light mode |
| ![Dashboard Dark](assets/screenshots/dash-dark.png) | ![Profiles](assets/screenshots/profiles-dark.png) |
| Dashboard — dark mode | Profile management |
| ![Doctor](assets/screenshots/doctor-dark.png) | |
| Diagnostics | |

## Usage

### Profiles

```bash
arc create <name>                  # Create a profile
arc list                           # List all profiles
arc use <name>                     # Switch active profile
arc profile show [name]            # Show profile details
arc profile delete <name>          # Delete a profile
arc profile import                 # Import existing tool config
```

### Launch

```bash
arc launch [name]                  # Launch agent tool with profile
arc launch [name] -- --model opus  # Pass flags through to the tool
```

### Dashboard

```bash
arc                                # Open TUI dashboard
arc dashboard                      # Same — explicit command
```

### Shared layer

```bash
arc shared pull [name]             # Push config to shared layer
arc shared enable [name]           # Sync shared config to a profile
arc shared sync                    # Re-apply to all enabled profiles
```

### Lifecycle

```bash
arc setup                          # Install shims, PATH, shell integration
arc update                         # Refresh shims and self-update
arc doctor                         # Run diagnostics
arc status                         # Show all profiles and auth status
```

See the [full command reference](./docs/index.md) for all commands.

## Shell Integration

After `arc setup`, agent tool commands automatically use the active profile:

```bash
eval "$(arc shell-init)"                                              # bash / zsh
arc shell-init --shell fish | source                                  # fish
arc shell-init --shell powershell | Out-String | Invoke-Expression    # PowerShell
```

## Data Layout

```
~/.arc/
  config.json              # Profile registry, active profile, settings
  profiles/
    <name>/                # Isolated tool config dir per profile
      .credentials.json    # OAuth tokens (Claude)
      oauth_creds.json     # OAuth tokens (Gemini)
      auth.json            # OAuth tokens (Codex)
      settings.json        # Tool settings
  shared/                  # Shared layer (synced across profiles)
  credentials/             # [experimental] Hot-swap snapshots
```

## Documentation

| Guide | |
|-------|-|
| [Getting Started](./docs/getting-started.md) | Install, requirements, first profile |
| [Profiles](./docs/profiles.md) | Create, switch, import, delete |
| [Authentication](./docs/authentication.md) | OAuth, API key, Bedrock, Vertex, Foundry |
| [Shell Integration](./docs/shell-integration.md) | Bash, zsh, fish, PowerShell |
| [Advanced Usage](./docs/advanced.md) | Shared layer, credential hot-swap, exec, subshell |
| [Configuration](./docs/configuration.md) | Data layout and config schema |
| [Development](./docs/development.md) | Build, test, contribute |
| [Troubleshooting](./docs/troubleshooting.md) | Common issues and fixes |

## Development

```bash
git clone https://github.com/Codename-11/ARC.git
cd ARC && pnpm install

pnpm install:local         # Build + install arc command (shims + PATH)
pnpm uninstall:local       # Remove shims (keeps ~/.arc/ config)

pnpm dev:tui               # Run TUI from source
pnpm dev:tui:watch         # TUI with hot-reload
pnpm typecheck             # TypeScript strict-mode check
```

See [Development](./docs/development.md) for the full guide.

## License

[MIT](LICENSE) — Copyright (c) 2025 [Bailey Dixon](https://github.com/Codename-11)

---

<p align="center">
  Built with the help of AI coding assistants and humans, with &lt;3<br><br>
  <a href="https://ko-fi.com/L4L31Q8LJ1"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="ko-fi"></a>
</p>
