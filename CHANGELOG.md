# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-03-28

### Added

- **Named profiles** — create, switch, delete, and import isolated agent configurations
- **Multi-tool support** — profiles target any agent CLI binary: `claude`, `gemini`, `codex`, or custom
- **Multi-tool auth detection** — OAuth credential reading for Claude (`.credentials.json`), Gemini (`oauth_creds.json`), and Codex (`auth.json` with JWT expiry decoding)
- **Auth flexibility** — OAuth, API key, AWS Bedrock, Google Vertex AI, and Foundry auth types
- **Secure storage** — API keys stored in the OS keyring with plaintext fallback
- **Shell integration** — wraps agent commands in bash, zsh, fish, and PowerShell
- **Environment isolation** — auth env vars sanitized between profiles to prevent credential leaks
- **TUI dashboard** — interactive terminal UI with views (Dash, Work, Profiles, Doctor, Settings, Guide), command palette (Ctrl+P), Photon/Carbon Night themes with persistence
- **Responsive ASCII logo** — 4-tier responsive logo (text, half-block, block, full) adapts to terminal height
- **Shared layer** — sync MCP servers, commands, CLAUDE.md, memory, and projects across profiles via `~/.arc/shared/`
- **Credential hot-swap** — [experimental] swap auth credentials without changing MCPs/settings/history
- **Self-update system** — `arc update` with npm registry check and TUI update banner
- **Lifecycle CLI** — `setup`, `update`, `teardown` managed from the same tool
- **Launch args** — per-profile default flags passed to the agent tool on every launch, displayed on launch
- **Profile ordering** — custom display order for profiles in the TUI
- **Bootstrap installers** — one-liner install for Windows (PowerShell) and macOS/Linux (bash)
- **Local dev install** — `pnpm install:local` / `pnpm uninstall:local` for shim-based dev workflow
- **Doctor command** — diagnostics for Node version, PATH, auth, shell integration, and config issues
- **Onboarding wizard** — interactive first-run setup with auto-detect of installed tools and batch import
- **Windows-first platform handling** — `cmd /c` for .cmd shim resolution, user PATH management, no `shell:true`
- **CI** — GitHub Actions CI on Ubuntu + Windows, automated release workflow with npm publish

### Fixed

- **Gemini/Codex auth status** — OAuth refresh token presence now means authenticated (not access token expiry)
- **TUI exit killing terminal** — proper alternate buffer cleanup, `process.exit(0)` on quit, `exitOnCtrlC: false`
- **Tool launch freezing** — `spawnSync` with `stdio:inherit` replaces async spawn for clean terminal handoff
- **Node 24 DEP0190 warnings** — `cmd /c` on Windows instead of `shell:true` throughout
- **Light mode contrast** — WCAG AA compliant dimmed/border colors, explicit `colors.text` on import hint
- **React hooks violation** — `useScreenSize()` moved above conditional returns in DashView

[Unreleased]: https://github.com/Codename-11/ARC/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Codename-11/ARC/releases/tag/v0.1.0
