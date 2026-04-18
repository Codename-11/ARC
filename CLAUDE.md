# CLAUDE.md — ARC Project

## What is ARC?

ARC (Agent Runtime Control) is a CLI + TUI for managing multiple agent profiles (Claude Code, Gemini CLI, Codex CLI, etc.) with isolated configs, credentials, and environments.

## Architecture

- **CLI layer:** Commander.js commands in `src/commands/`
- **TUI layer:** Ink + React components in `src/tui/`
  - **Views:** Dash, Work (session), Profiles, Doctor, Settings, Guide (in-app docs), Tasks, Memory, Skills, Sync, Telemetry (Traces), Agents
  - **Overlays:** CreateProfileOverlay, HelpOverlay, CommandPalette, SwapOverlay, SharedDetailOverlay, ProfileInfoOverlay, Update overlay
  - **OnboardingScreen:** fullscreen first-run wizard with multi-select tool import, optional rename, batch import
  - **Workspace shell:** tokenized input with syntax highlighting (`/command` green, `@profile` blue, `#tag` dimmed) and auto-complete overlay (Tab/Enter accept, arrows navigate); runs shell commands with profile env; `/` commands for ARC actions
  - **Input components:** `TokenizedInput` (tokenizer + colored rendering), `AutoComplete` (suggestion resolver + overlay)
  - **Doctor repair actions:** install hints, re-auth instructions, PATH/shell fix hints displayed inline
  - **Shared layer controls:** `h` key in ProfilesView toggles shared layer per profile; sync status in SettingsView and ProfileList
  - **Credential hot-swap:** SwapOverlay (`src/tui/views/SwapOverlay.tsx`) — capture/swap/delete via command palette. [experimental]
  - **Update system:** DashView shows update-available banner; `u` key triggers in-app update overlay
  - **Scrollable views:** ScrollBox component (`src/tui/components/ScrollBox.tsx`) for arrow-key scrolling
- **Update module:** `src/update.ts` — cached npm registry check, self-update via `npm install -g`
- **Credential hot-swap:** `src/swap.ts` — [experimental] swap auth credentials in canonical tool dir without changing MCPs/settings/history. CLI: `arc swap capture/to/list/delete`. TUI: SwapOverlay via command palette
- **Shared layer:** `src/shared.ts` — syncs MCP servers, commands, CLAUDE.md, memory, and projects across profiles via `~/.arc/shared/`. Pull/push with cross-tool warnings.
- **Import utilities:** `src/import-utils.ts` — shared skip list, auth detection, entry descriptions
- **Wizard types:** `src/tui/wizardTypes.ts` — shared step types and metadata helpers for profile creation wizards
- **Activity log:** `src/log.ts` — timestamped action log to `~/.arc/activity.log`
- **Single entry point:** `src/index.ts` → `src/cli.ts`
- **Bundled output:** `tsup` produces a single `dist/index.js` with shebang
- **Landing site:** `site/` — React 19 + Vite + Tailwind v4, Nothing-design marketing page
- **Deployment:** Root `Dockerfile` + `nginx.conf` — multi-stage build merging `site/` at `/` and `user-docs/` at `/docs/` into single nginx container
- **Web Dashboard:** 13 view components (Overview, Sessions, Traces, Risk, Tasks, Skills, Memory, Agents, Factory + Profiles, Diagnostics, Sync, Plugins)
- **Orchestration layer:** Hook pipeline (8 hooks in priority order), roundtable multi-agent discussions, task delegation protocol, interagent routing, source classification
- **Adapters:** Claude Code (SDK + plugin + hooks), Codex CLI, Gemini CLI, OpenClaw (native plugin), Hermes Agent (MCP bridge), OpenAI Compatible (custom providers), Generic (fallback for any tool)
- **Agent instructions:** `instructions` / `instructionsFile` fields on Profile; resolved at launch, injected as `ARC_AGENT_INSTRUCTIONS` env var; `arc instructions` CLI for show/set/edit/clear
- **Custom providers:** `openai-compat` auth type + `ProviderConfig` (baseUrl, model, apiKeyEnvVar) on Profile; 7 presets (OpenRouter, Ollama, LM Studio, Together, Groq, MiniMax, DeepSeek); `arc provider` CLI for set/show/clear/presets
- **Launch modes:** `launchMode: "native" | "worker"` on Profile (default `native`). Native uses full TTY handoff so the tool paints its own TUI; worker uses `spawnManagedProcess` for ARC-supervised orchestration. CLI flags `--native` / `--worker` override. TUI: `m` in ProfilesView toggles. Roundtable forces worker regardless.
- **Bare launch:** `arc run <tool>` and `arc launch --bare <tool>` skip ARC overlay entirely (no env injection, no hook pipeline). Tool-name inference falls through to bare when no matching profile exists. `activeProfile` may be `null` — cleared via `arc profile switch none` or `arc profile clear-active`, rendered as `(none)`.
- **Agent client (internal):** `packages/core/src/agent-client/` — CLI-spawn clients for Claude/Codex/Gemini with MCP config injection per `mcpMode` variant and per-tool stream parsers. Foundation for upcoming `arc chat` + roundtable orchestrator. See `docs/plans/ai-and-roundtable.md`.
- **Agent loop + tool registry (internal):** `packages/core/src/agent/` — tool registry with read-only/supervised/autonomous permission modes, agent loop for tool-use dispatch.
- **Knowledge (internal):** `packages/core/src/knowledge/` — static + runtime system prompt composition (ARC architecture, command reference, live state).

## Key Conventions

- **Version:** single source of truth in `packages/cli/src/version.ts`, synced to root `package.json` + `site/package.json` via `node scripts/version.js <version>`
- **Commits:** Conventional Commits (`feat`, `fix`, `docs`, `refactor`, `chore`)
- **Branches:** `feature/<name>`, `fix/<name>`, `docs/<name>`
- **TypeScript:** strict mode, ESM (`"type": "module"`)
- **Platform:** Windows-first, cross-platform (macOS, Linux)

## Development Commands

```bash
pnpm cli:dev -- --help     # Run from source
pnpm dev:tui               # TUI dashboard from source
pnpm dev:tui:watch          # TUI with hot-reload
pnpm typecheck             # Must pass before commit
pnpm build                 # Production bundle
pnpm test                  # Run all tests (E2E + integration)
pnpm test:watch            # Tests with hot-reload
pnpm site:dev              # Landing site dev server
pnpm web                   # Site + docs concurrently
pnpm web:build             # Production build (both)
pnpm web:preview           # Build + merge + serve on :4000
pnpm dev:dashboard         # Web dashboard dev server
```

## Data Layout

```
~/.arc/
  config.json              # Profile registry + active profile
  update-check.json        # Cached latest version from npm (4h TTL)
  credentials/<account>/   # [experimental] Hot-swap credential snapshots
  profiles/<name>/         # Isolated tool config dirs
  shared/                  # Shared layer (settings.json, commands/, CLAUDE.md, memory/, projects/)
```

## Feature Tracking

See [FEATURES.md](./FEATURES.md) for the full backlog.
