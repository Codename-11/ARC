# ARC v0.1.0-beta

First public beta of ARC — Agent Runtime Control.

## Highlights

- **Multi-account profiles** — manage multiple Claude, Gemini, and Codex configurations from one CLI
- **Shared layer** — sync MCP servers, commands, memory, and CLAUDE.md across all profiles
- **TUI dashboard** — interactive terminal UI for browsing, launching, and switching profiles
- **Cross-platform** — Windows-first with full macOS/Linux support; bash, zsh, fish, and PowerShell shell integration

## Install

```bash
npm install -g @axiom-labs/arc-cli
arc setup
```

Or use the bootstrap one-liner:

**PowerShell:**
```powershell
irm https://raw.githubusercontent.com/Codename-11/ARC/master/scripts/bootstrap.ps1 | iex
```

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/Codename-11/ARC/master/scripts/bootstrap.sh | bash
```

## What's Included

- Profile creation, import, switching, deletion
- OAuth, API key, Bedrock, Vertex, Foundry authentication
- OS keyring storage with plaintext fallback
- Shell integration (auto-wraps agent commands with active profile)
- Environment isolation between profiles
- TUI dashboard with keyboard navigation
- Shared MCP servers, commands, CLAUDE.md, memory, and projects across profiles
- Per-profile launch args and env overrides
- Doctor diagnostics and onboarding wizard
- Setup/update/uninstall lifecycle management

## Known Limitations

- TUI setup/import/doctor flows are CLI-only for now
- Workspace-aware profile selection is not yet implemented
- Profile inheritance is planned but not available in this release

## Feedback

Please report issues at https://github.com/Codename-11/ARC/issues
