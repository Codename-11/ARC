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
| [Advanced Usage](./advanced.md) | exec, subshell, env overrides, and prune |
| [Configuration](./configuration.md) | Data layout and config schema |
| [Development](./development.md) | Build, test, and contribute |
| [Troubleshooting](./troubleshooting.md) | Common issues and fixes |

## Quick Reference

```bash
arc create <name>          # Create a profile
arc list                   # List profiles
arc launch [name]          # Launch agent tool
arc use <name>             # Switch active profile
arc status                 # Show all profile statuses
arc setup                  # Install shims and shell integration
arc update                 # Refresh shims and integration
arc uninstall              # Remove everything
```
