# Expansion Ideas

This project is expanding beyond a Claude-only multi-account manager into a tool-agnostic local runtime manager for agent CLIs such as Claude, Gemini, Codex, and others.

## Product Direction

- Rebrand toward a tool-agnostic identity rather than a Claude-specific utility.
- Keep the current Claude import/launch flow working while generalizing the architecture.
- Treat setup, update, uninstall, diagnostics, and profile management as first-class CLI features.
- Make Windows a first-class platform, not a best-effort path.

## Core Feature Areas

### Multi-Tool Support

- Multi-tool adapters for `claude`, `codex`, `gemini`, and later other CLIs behind one launch/import/status interface.
- Tool-specific profile bindings so one profile can define the tool, auth method, config dir, env vars, defaults, and launch args.
- Session routing so different repos or tasks can default to different tools.
- Plugin/adapter system so new CLIs can be added without rewriting the core.

### Import, Setup, and Lifecycle

- Importers and migration wizards that detect existing installs/configs for each supported CLI and convert them into managed profiles.
- Bootstrap installers that install the manager plus supported tools from a fresh machine.
- Managed updates for wrappers, shims, shell integration, and optionally underlying tool CLIs.
- Cross-platform launcher repair that detects and fixes broken PATH, stale shims, and conflicting binary names.
- Unified install/setup/update/uninstall lifecycle managed directly from the CLI.

### Profiles and Configuration

- Profile inheritance with a base profile plus local overrides for work/personal/client setups.
- Workspace binding so profiles/tools can be auto-selected based on repo path or project config.
- Project-local config file such as `arc.json` for preferred tool/profile/statusline behavior.
- Team/shared config checked into repos with local secret overlays.
- Backup/export/import so profiles and settings can move between machines safely.

### Auth and Secrets

- Secret management improvements across keyring, env file, and cloud secret provider backends.
- Tool-aware auth flows with clear detection of missing, expired, or broken credentials.
- Import of existing tool auth/session state where feasible.

### Shell and UX

- Shell activation model: `use`, `current`, `deactivate`, and profile-aware environment activation across PowerShell, bash, zsh, and fish.
- Statusline integration with install/remove presets and active tool/profile display.
- Launch presets for approval mode, sandbox mode, model, cwd, env overlays, and prompt templates.
- Workspace-aware shell behavior so entering a repo can suggest or activate the right profile/tool.

### Diagnostics and Observability

- Doctor/diagnostics for PATH issues, missing binaries, broken auth, shell profile problems, bad config, stale shims, and version mismatches.
- Usage/history views for recent launches, active profile changes, failures, and update state.
- Policy layer for per-profile defaults such as approval behavior, sandbox defaults, and env exposure rules.

## TUI Direction

**Status: v1 shipped.** The TUI dashboard (`arc` / `arc dashboard`) provides:

  - 6 views: Dash (landing), Workspace, Profiles, Log, Doctor, Settings
  - Photon (light, default) and Carbon Night (dark) themes with persistence
  - ASCII logo on Dash with at-a-glance status overview
  - Ctrl+P command palette, Ctrl+T theme toggle, Ctrl+Q quit
  - Sidebar shortcuts: q (quit), t (theme), c (create), ? (help)
  - Profile creation wizard overlay (name → tool → auth → confirm)
  - Slash commands in workspace: /launch, /switch, /dash, /profiles, /doctor, /settings, /help, /create, /clear
  - Mouse scroll capture to prevent buffer disruption
  - Responsive layout with min-size guard (72x18)

Shipped since v1:
  - Fullscreen TUI onboarding wizard (OnboardingScreen) with auto-detect + stepped profile creation
  - Doctor repair actions: install hints, re-auth instructions, PATH/shell fix hints inline
  - Auto-detect import step in CreateProfileOverlay (import detected tools or create new)
  - Shared layer sync status in SettingsView (per-profile sync details) and ProfileList (shared indicator)
  - GitHub repo link on DashView and HelpOverlay
  - Complete help overlay overhaul (global, sidebar, workspace, profiles sections)

Remaining TUI work:
  - setup/update/uninstall flows inside the TUI
  - statusline/shell integration management
  - search/filter for large profile lists
  - activity log persistence (currently placeholder)

## External Reference

- Reference idea: Every Code
  - Repo: https://github.com/just-every/code
  - Useful as inspiration for a polished wrapper experience around underlying agent tooling.
  - We should consider our own integrated CLI/TUI wrapper experience rather than only exposing raw commands and scripts.

## Highest-Leverage Next Steps

1. Define a tool-adapter architecture that keeps Claude working while making room for Codex and Gemini.
2. Finish the unified setup/update/uninstall/doctor lifecycle.
3. ~~Add importer/migration flows for existing local tool installations.~~ **Done** — OnboardingScreen and CreateProfileOverlay auto-detect and import existing tool configs.
4. Add workspace-aware profile selection and project-local config.
5. ~~Design and prototype an optional TUI control surface.~~ **Done** — expand TUI with setup/import/doctor flows.
