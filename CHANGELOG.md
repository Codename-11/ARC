# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Branded ASCII logo** — full `[>] ARC //` logo from `assets/ASCII.md` with theme-aware contrast colors for `>` and `//` elements
- **Multi-select import** — onboarding and profile creation now support selecting multiple tools at once with checkboxes (space to toggle, `a` for all), optional rename before batch import
- **Account tier display** — reads `subscriptionType` and `rateLimitTier` from Claude credentials (e.g. "max (20x)") and shows in dashboard status
- **Shell command execution** — Workspace view accepts bare shell commands (non-`/` input), runs with active profile env, pipes output to activity log
- **Self-update system** — `arc update` performs npm install for global installs; startup version check in CLI; TUI DashView shows update-available banner with `u` key to trigger in-app update
- **Credential hot-swap** — [experimental] `arc swap capture/to/list/delete` swaps auth credentials in the tool's canonical config dir while preserving MCPs, settings, and session history. TUI: SwapOverlay accessible via command palette with capture/swap/delete actions
- **Shared layer TUI controls** — `h` key in ProfilesView toggles shared layer per profile with inline status; key hints bar added to Profiles view
- **Scrollable Settings view** — Settings uses ScrollBox with arrow key scrolling for long content; content always fits cleanly
- **Per-profile import progress** — importing step shows live ✔/✘ per profile with spinner on current, error details inline
- **TUI onboarding wizard** — fullscreen `OnboardingScreen` on first run with auto-detect of installed tools and stepped profile creation (name, tool, auth, confirm)
- **Doctor repair actions** — inline install hints (e.g. `npm install -g`), re-auth instructions, and PATH/shell fix hints in the DoctorView
- **Auto-detect import** — `CreateProfileOverlay` and `OnboardingScreen` detect existing tool configs and offer one-click import before manual creation
- **Shared layer sync status** — `SettingsView` displays per-profile sync details (last synced, MCP servers, commands, CLAUDE.md, memory, projects); `ProfileList` shows a shared indicator column
- **GitHub repo link** — shown on the DashView landing page and in the HelpOverlay
- **Help overlay overhaul** — reorganized into Global, Sidebar, Workspace, and Profiles sections with full slash command reference

### Fixed

- **Import spinner freeze** — converted `importProfile()` to fully async `fs.promises` so spinner animates smoothly
- **Gemini import symlink error** — Windows EPERM on symlinks fixed with `dereference: true` and graceful skip
- **Slow imports** — skip ephemeral data (sessions, history, extensions/node_modules, sqlite, cache) during import
- **Import errors surfaced** — failed imports now show ✘ with error detail instead of being silently swallowed; errors persist until user acknowledges
- **Logo clipping on dashboard** — replaced full 6-line logo with compact `[>]` logomark + inline status layout
- **Unicode arrow literal** — `\u2190` in JSX now rendered via JS expression instead of literal string
- **TUI launch teardown** — Ink `exit()` called before spawning agent tool so terminal restores cleanly
- **Codex detection** — added `config.toml` and `auth.json` as marker files for Codex CLI

### Removed

- **Rust prototype** — deleted `rust/` directory (replaced by TypeScript implementation)

## [0.1.0-beta] - 2026-03-26

### Added

- **Named profiles** — create, switch, delete, and import isolated agent configurations
- **Multi-tool support** — profiles target any agent CLI binary: `claude`, `gemini`, `codex`, or custom
- **Auth flexibility** — OAuth, API key, AWS Bedrock, Google Vertex AI, and Foundry auth types
- **Secure storage** — API keys stored in the OS keyring with plaintext fallback
- **Shell integration** — wraps agent commands in bash, zsh, fish, and PowerShell
- **Environment isolation** — auth env vars sanitized between profiles to prevent credential leaks
- **TUI dashboard** — interactive terminal UI with 6 views (Dash, Workspace, Profiles, Log, Doctor, Settings), command palette (Ctrl+P), Photon/Carbon Night themes with persistence, profile creation wizard, and slash commands
- **Shared layer** — sync MCP servers, commands, CLAUDE.md, memory, and projects across profiles via `~/.arc/shared/`
- **Lifecycle CLI** — `setup`, `update`, `uninstall` managed from the same tool
- **Launch args** — per-profile default flags passed to the agent tool on every launch
- **Profile ordering** — custom display order for profiles in the TUI
- **Bootstrap installers** — one-liner install for Windows (PowerShell) and macOS/Linux (bash)
- **Doctor command** — diagnostics for PATH, auth, shell integration, and config issues
- **Onboarding wizard** — interactive first-run setup when no profiles exist

[0.1.0-beta]: https://github.com/Codename-11/ARC/releases/tag/v0.1.0-beta
