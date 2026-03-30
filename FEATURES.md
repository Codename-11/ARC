# FEATURES.md — ARC Feature Backlog

Tracking file for planned features, enhancements, and ideas. Checked items are shipped. See `docs/expansion-ideas.md` for broader product direction.

## Priority 1 — Core UX Gaps

- [x] **Profile creation in TUI** — stepped overlay form (name → tool → auth type → done) so users don't have to exit the TUI to create profiles
- [x] **Theme persistence** — save theme choice (`light`/`dark`) to `config.json` so it survives restarts
- [ ] **Actionable Dash view** — Enter on active profile to launch; show `ImportHint` when unimported tools detected
- [ ] **Persist activity to Log view** — write launch/switch/error events to a shared log so the Log view shows real history instead of a placeholder
- [ ] **Surface profile metadata** — show description, launchArgs, envOverrides, and credential expiry in Profiles detail pane

## Priority 2 — Workflow Improvements

- [ ] **Workspace-aware profile auto-selection** — `arc.json` in repo root specifies preferred profile/tool; shell hook auto-switches on `cd`
- [ ] **Quick profile switch overlay** — global `Ctrl+S` or palette action that shows a focused profile picker from any view
- [x] **Doctor repair actions** — inline install hints, re-auth instructions, and PATH/shell fix hints on actionable diagnostics
- [ ] **Profile search/filter** — `/` search in Profiles view and queue for scaling to 10+ profiles
- [x] **Import/migration wizard in TUI** — auto-detect step in CreateProfileOverlay and OnboardingScreen imports detected tools interactively
- [ ] **Environment preview before launch** — show env vars, config dir, binary path before spawning a profile

## Priority 3 — Architecture & Platform

- [ ] **Per-tool shared layer namespaces** — granular enable/disable shared items per tool (e.g. only sync Claude MCPs to Claude profiles, Gemini MCPs to Gemini profiles)
- [ ] **Tool-adapter architecture** — formal plugin interface so new CLIs can be added without core changes
- [ ] **Profile inheritance** — base profile + local overrides for work/personal/client setups
- [ ] **Project-local config** (`arc.json`) — preferred tool, profile, statusline behavior per repo
- [ ] **Team/shared config** — repo-checked config with local secret overlays
- [ ] **Backup/export/import** — move profiles and settings between machines
- [ ] **Managed updates** — update wrappers, shims, shell integration, and optionally tool CLIs from ARC

## Priority 4 — Observability & Polish

- [ ] **Launch history on Dash** — recent launches list (`{ profile, tool, timestamp }`) in `~/.arc/history.json`, displayed on Dash after first session
- [x] **Shared layer visibility** — SettingsView shows per-profile sync details; ProfileList shows shared indicator column
- [ ] **Toast notifications** — brief auto-dismiss messages for confirmations/errors that work across all views
- [ ] **Interactive sidebar queue** — Enter on sidebar profile list to quick-launch without switching views
- [ ] **MCP server management** — browse, validate, and toggle MCP server definitions from TUI
- [ ] **Policy layer** — per-profile defaults for approval behavior, sandbox mode, env exposure rules
- [ ] **Profile cloning/duplication** — create a new profile from an existing one as template
- [ ] **Usage/audit log** — persistent record of profile switches, launches, failures, and update state

## Completed

- [x] TUI dashboard with Ink (sidebar, views, command palette, overlays)
- [x] Multi-tool support (Claude, Gemini, Codex) with auth adapters
- [x] Shared layer sync (MCP servers, commands, CLAUDE.md, memory, projects)
- [x] Shell integration (bash, zsh, fish, PowerShell)
- [x] Doctor diagnostics (config, PATH, shell, binaries, credentials)
- [x] Credential checking with expiry tracking
- [x] Photon/Carbon Night theme system with toggle
- [x] Dash view with ASCII logo and status overview
- [x] Ctrl-modified hotkeys to avoid typing conflicts
- [x] Mouse scroll capture in fullscreen TUI
- [x] Log view placeholder
- [x] Command palette and help overlay
- [x] Fullscreen TUI onboarding wizard (OnboardingScreen) with auto-detect + stepped creation
- [x] Doctor repair actions (install hints, re-auth instructions, PATH/shell fix hints)
- [x] Auto-detect import in CreateProfileOverlay and OnboardingScreen
- [x] Shared layer sync status in SettingsView and ProfileList
- [x] GitHub repo link on DashView and HelpOverlay
- [x] Help overlay overhaul (global, sidebar, workspace, profiles sections)

## Infra / Chores

- [x] E2E + integration testing (vitest, ink-testing-library) — CLI spawn tests, TUI smoke + interactive flow tests, profile CRUD, shared layer sync
- [x] CI: run `pnpm typecheck`, `pnpm build`, and `pnpm test` on PRs (ubuntu + windows matrix)
- [ ] Add `.github/dependabot.yml` for automated dependency updates
