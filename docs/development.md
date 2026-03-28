# Development

## Setup

```bash
git clone https://github.com/Codename-11/ARC.git
cd ARC
pnpm install
```

## Local install / uninstall

The fastest way to get the `arc` command available system-wide from your checkout:

```bash
pnpm install:local       # Build + create shims + add to PATH
pnpm uninstall:local     # Remove shims + PATH entry (keeps ~/.arc/ config)
```

`install:local` is idempotent — re-run it after `git pull` to rebuild and refresh shims. Shims in `~/.local/bin/` point at your working copy's `dist/index.js`, so a `pnpm build` is enough to pick up changes without re-running the install.

> **Windows:** Restart your terminal after the first install for PATH changes to take effect.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile TypeScript via tsup to `dist/` |
| `pnpm typecheck` | TypeScript strict-mode check |
| `pnpm dev` | Run CLI from source (tsx, no build step) |
| `pnpm dev:tui` | Run TUI dashboard from source |
| `pnpm dev:tui:watch` | TUI with hot-reload (restarts on file change) |
| `pnpm dev:watch` | Rebuild `dist/` on file change (tsup --watch) |
| `pnpm cli -- <args>` | Run the built CLI from `dist/` |
| `pnpm cli:dev -- <args>` | Run CLI from source (no build step) |

### TUI development

The TUI uses [Ink](https://github.com/vadimdemedes/ink) (React for the terminal). Components live in `src/tui/`.

**Fastest iteration loop:**

```bash
pnpm dev:tui:watch    # Watches src/ and restarts on .ts/.tsx changes
```

tsx supports JSX natively, so edits to `.tsx` files take effect immediately on restart.

**Testing the production bundle:**

```bash
pnpm dev:watch                   # Rebuilds dist/ on every file change
node dist/index.js dashboard     # Test the built output
```

## Alternative install methods

### Global link (pnpm/npm)

```bash
pnpm link:global            # Build + pnpm link --global
pnpm unlink:global          # Remove the global link

# or via npm
npm run link:global:npm     # Build + npm link
```

### Local shims (low-level)

```bash
npm run setup:local-bin     # Install shims into ~/.local/bin (no build)
```

> Prefer `pnpm install:local` — it builds first and has better output.

## Bootstrap scripts

For end-user installs (clone from GitHub + install + setup):

```bash
# Windows (PowerShell)
pnpm bootstrap:windows
# or directly:
powershell -ExecutionPolicy Bypass -File scripts/bootstrap.ps1

# macOS / Linux
pnpm bootstrap:unix
# or directly:
bash scripts/bootstrap.sh
```

## Uninstall

| Command | What it removes |
|---------|-----------------|
| `pnpm uninstall:local` | Shims + PATH entry only (keeps `~/.arc/` config) |
| `pnpm teardown` | Full teardown: keyring, `~/.arc/`, global links, shims, shell integration |
| `pnpm teardown:force` | Same as above, no confirmation prompt |

## Scripts reference

| Script | npm command | Purpose |
|--------|-------------|---------|
| `scripts/install-local.js` | `pnpm install:local` | Build + shims + PATH for local dev |
| `scripts/uninstall-local.js` | `pnpm uninstall:local` | Remove shims + PATH (keep config) |
| `scripts/setup-local-bin.js` | `pnpm setup:local-bin` | Low-level shim install (no build) |
| `scripts/uninstall.js` | `pnpm teardown` | Full system teardown |
| `scripts/bootstrap.ps1` | `pnpm bootstrap:windows` | End-user Windows install |
| `scripts/bootstrap.sh` | `pnpm bootstrap:unix` | End-user macOS/Linux install |
| `scripts/version.js` | `pnpm version:set` | Sync version to package.json |
| `scripts/tag.js` | `pnpm tag` | Create git tag from current version |
| `scripts/dev-tui.mjs` | `pnpm dev:tui:watch` | TUI hot-reload watcher |
| `scripts/postinstall.js` | (automatic) | Post-install banner shown after `npm install` |

## Project structure

```
src/
  index.ts             # Entry point
  cli.ts               # Command registration (Commander)
  version.ts           # Single source of truth for VERSION
  config.ts            # Profile registry read/write
  auth.ts              # Credential detection and env building
  import-utils.ts      # Import skip list, auth detection, file descriptions
  shared.ts            # Shared layer sync/unsync logic
  detect.ts            # Auto-detect installed tool configs
  update.ts            # npm registry version check + self-update
  swap.ts              # [experimental] Credential hot-swap
  keyring.ts           # OS keyring wrapper
  paths.ts             # Platform-aware path helpers
  display.ts           # Colored output helpers
  types.ts             # TypeScript interfaces
  commands/
    onboarding.ts      # First-run wizard (tool + auth type selection)
    profile.ts         # create, list, use, show, delete, import
    launch.ts          # launch command (uses profile.tool)
    setup.ts           # setup / update / uninstall commands
    shared.ts          # shared layer commands (status, enable, disable, sync, show)
    doctor.ts          # diagnostics command
    shell-init.ts      # shell-init command (outputs shell functions)
    shell.ts           # shell subshell command
    exec.ts            # exec command
    set-key.ts         # set-key command
    status.ts          # status command
    prune.ts           # prune command
    resolve.ts         # _resolve-config-dir (internal, used by shell wrapper)
  tui/
    Dashboard.tsx      # Root Ink component (keyboard nav, overlays, view routing)
    render.tsx         # Entry point — renders Ink app with TTY guard + mouse capture
    theme.tsx          # Theme provider with Photon (light) / Carbon Night (dark)
    useProfiles.ts     # React hook — loads profiles + auth status
    createProfile.ts   # Profile creation logic (validation, tool/auth options)
    wizardTypes.ts     # Shared step types and metadata helpers for profile wizards
    components/
      ArcLogo.tsx      # ASCII logo variants (FullLogo, LogoMark, LogoWithArc)
      TopBar.tsx       # Top navigation with version and profile status
      Header.tsx       # Branded header bar
      Sidebar.tsx      # Navigation menu
      ProfileList.tsx  # Interactive multi-column profile table
      Footer.tsx       # Keybinding hints + version display
      Layout.tsx       # Layout wrapper
      Overlay.tsx      # Overlay container
      ScrollBox.tsx    # Scrollable container for arrow-key scrolling
      ImportHint.tsx   # Unimported tool detection hint
      StepHint.tsx     # Wizard step indicator
    views/
      OnboardingScreen.tsx      # Fullscreen first-run wizard
      DashView.tsx              # Dashboard landing (logo, status, quick start)
      DashboardView.tsx         # Active-profile card and overview stats
      SessionView.tsx           # Workspace command shell
      ProfilesView.tsx          # Profile management
      SettingsView.tsx          # Settings display + shared layer sync status
      DoctorView.tsx            # Diagnostics with inline repair hints
      AboutView.tsx             # In-app guide (profiles, shared layer, hot-swap docs)
      CommandPalette.tsx        # Command picker overlay
      CreateProfileOverlay.tsx  # Profile creation wizard overlay
      HelpOverlay.tsx           # Keybinding help overlay
      SwapOverlay.tsx           # [experimental] Credential hot-swap overlay
      ProfileInfoOverlay.tsx    # Profile detail overlay
      SharedDetailOverlay.tsx   # Shared layer detail overlay
scripts/
  install-local.js     # Local dev install (build + shims + PATH)
  uninstall-local.js   # Local dev uninstall (shims + PATH only)
  setup-local-bin.js   # Low-level shim install
  uninstall.js         # Full system teardown
  bootstrap.ps1        # Windows one-liner bootstrap
  bootstrap.sh         # macOS/Linux one-liner bootstrap
  tag.js               # Git tag helper
  version.js           # Version bump (updates package.json + src/version.ts)
  dev-tui.mjs          # TUI hot-reload watcher
```

## Adding support for a new agent tool

The extension point is minimal:

1. **`src/auth.ts`** — `buildProfileEnv()` handles tool-specific env vars. Add a case for the new tool. Also add a credential reader function if the tool has its own OAuth format (see `readGeminiOAuthCredentials` / `readCodexOAuthCredentials` for examples).
2. **`src/detect.ts`** — Add an entry to `TOOL_SIGNATURES` with the tool's config directory and marker files.
3. **`src/import-utils.ts`** — Add the tool's ephemeral files to `IMPORT_SKIP` and credential files to `detectAuthType()`.
4. **`src/commands/shell-init.ts`** — Add a wrapper function for the new tool's binary.
5. **`src/commands/profile.ts`** — Add tool-specific import logic in `handleImport` if needed.
6. **`src/commands/onboarding.ts`** — Already lists Claude, Gemini, and Codex as options.

The `profile.tool` field flows through `handleLaunch` to determine which binary to spawn.

## Publishing

```bash
# Bump version (updates package.json + src/version.ts)
node scripts/version.js <version>

# Build, typecheck, then publish to npm as @axiom-labs/arc-cli
pnpm publish
```

The `prepublishOnly` hook runs `pnpm typecheck && pnpm build` automatically.

To tag and release:

```bash
pnpm tag                     # Create git tag from current version
```

Pushing the tag triggers the GitHub Actions release workflow (CI, npm publish, GitHub Release).
