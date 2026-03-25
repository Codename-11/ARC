# Development

## Setup

```bash
git clone https://github.com/Codename-11/ARC.git
cd ARC

# Install dependencies (npm also works)
pnpm install
```

## Commands

```bash
pnpm build           # Compile TypeScript via tsup → dist/
pnpm dev             # Run from source (tsx, no build step)
pnpm dev:dash        # Run TUI dashboard from source
pnpm dev:watch       # Rebuild on file change (tsup --watch)
pnpm typecheck       # TypeScript strict-mode check
```

### Running locally

```bash
pnpm cli -- --help          # Run the built CLI (arc) from dist/
pnpm cli:dev -- --help      # Run from source (no build step required)
pnpm dev:dash               # Launch TUI dashboard from source (no build)
```

### TUI development

The TUI uses [Ink](https://github.com/vadimdemedes/ink) (React for the terminal). Components live in `src/tui/`.

**Fastest iteration loop:**

```bash
pnpm dev:dash        # Runs tsx src/index.ts dashboard — no build step
```

tsx supports JSX natively, so edits to `.tsx` files take effect immediately on next run.

**Watch mode** (for testing the production bundle):

```bash
pnpm dev:watch       # Rebuilds dist/ on every file change
node dist/index.js dashboard   # Test the built output
```

### Linking globally for testing

```bash
pnpm link:global            # Build + pnpm link --global
# or
npm run link:global:npm     # Build + npm link

pnpm unlink:global          # Remove the global link when done
```

### Local user shims (Windows-friendly)

```bash
npm run setup:local-bin     # Install shims into ~/.local/bin
# or
npm run cli -- setup        # Full setup flow (also sets PATH + shell integration)
```

## Bootstrap scripts

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/bootstrap.ps1

# macOS / Linux
bash scripts/bootstrap.sh
```

## Local checkout on Windows

`npm install` builds `dist/` but does not make `arc` available as a bare command in the current shell. Use one of:

- `npm run cli -- <args>` — run from built `dist/`
- `npm run cli:dev -- <args>` — run from source
- `npm exec -- arc -- <args>`

For a persistent setup run `npm run link:global:npm` or `npm run setup:local-bin`.

If `npm link` succeeds but `arc` is still not found, your npm global bin directory is not on `PATH`. Check `npm prefix -g` and add it to your Windows user `PATH`.

## Project structure

```
src/
  cli.ts               # Command registration (Commander)
  index.ts             # Entry point
  config.ts            # Profile registry read/write
  auth.ts              # Credential detection and env building
  keyring.ts           # OS keyring wrapper
  paths.ts             # Platform-aware path helpers
  display.ts           # Colored output helpers
  types.ts             # Shared TypeScript types
  commands/
    onboarding.ts      # First-run wizard (tool + auth type selection)
    profile.ts         # create, list, use, show, delete, import
    launch.ts          # launch command (uses profile.tool)
    setup.ts           # setup / update / uninstall commands
    shell-init.ts      # shell-init command (outputs shell functions)
    shell.ts           # shell subshell command
    exec.ts            # exec command
    set-key.ts         # set-key command
    status.ts          # status command (shows tool column)
    prune.ts           # prune command
    resolve.ts         # _resolve-config-dir (internal, used by shell wrapper)
  tui/
    Dashboard.tsx      # Root Ink component (keyboard nav, actions)
    render.tsx         # Entry point — renders Ink app with TTY guard
    useProfiles.ts     # React hook — loads profiles + auth status
    components/
      Header.tsx       # Branded header bar
      ProfileList.tsx  # Interactive multi-column profile table
      Footer.tsx       # Keybinding hints
scripts/
  bootstrap.ps1        # Windows one-liner bootstrap
  bootstrap.sh         # macOS/Linux one-liner bootstrap
  setup-local-bin.js   # Install local shims + PATH setup
  uninstall.js         # Remove shims, PATH, keyring, shell integration
  tag.js               # Git tag helper
  version.js           # Version bump helper
```

## Adding support for a new agent tool

The extension point is minimal:

1. **`src/auth.ts`** — `buildProfileEnv()` currently handles Claude-specific env vars. Add a `case "your-tool":` block that sets the tool's auth env vars.
2. **`src/commands/shell-init.ts`** — Add a wrapper function for the new tool's binary alongside the existing `claude()` wrapper.
3. **`src/commands/profile.ts`** — The `handleImport` function has a Claude-specific `.claude.json` copy step guarded by `tool === "claude"`. Add equivalent logic for new tools.
4. **`src/commands/onboarding.ts`** — Already lists Claude, Gemini, and Codex as options in the tool selection prompt.

The `profile.tool` field already flows through `handleLaunch` to determine which binary to spawn.

## Publishing

```bash
# Bump version
npm run version:set -- <version>

# Build, typecheck, then publish to npm as arccli
pnpm publish
```

The `prepublishOnly` hook runs `pnpm typecheck && pnpm build` automatically.
