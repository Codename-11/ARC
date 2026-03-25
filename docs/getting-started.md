# Getting Started

## Requirements

- **Node.js 18+**
- **An agent tool** — e.g. `npm install -g @anthropic-ai/claude-code`
- **Build tools** for the native keyring module (optional — falls back to plaintext if absent):
  - **Windows** — Visual C++ Build Tools
  - **macOS** — Xcode Command Line Tools (`xcode-select --install`)
  - **Linux** — `build-essential` and `libsecret-1-dev`

## Installation

### Bootstrap (recommended — especially on Windows)

The bootstrap is the primary install path. It clones the repo, installs dependencies, runs `arc setup`, and launches the interactive setup wizard — all in one step.

**PowerShell (Windows):**

```powershell
irm https://raw.githubusercontent.com/Codename-11/ARC/main/scripts/bootstrap.ps1 | iex
```

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/Codename-11/ARC/main/scripts/bootstrap.sh | bash
```

What the bootstrap does:

1. Clones or updates the repo into `~/.arc-install/repo`
2. Runs `npm install`
3. Runs `arc setup` — installs shims into `~/.local/bin`, adds to user `PATH` (Windows), writes shell integration
4. Launches `arc` — the onboarding wizard walks you through creating your first profile

After bootstrap, open a new terminal and run `arc` to open the **TUI dashboard**.

> **Windows:** A new terminal is required after the first install for PATH changes to take effect.

### npm

```bash
npm install -g arccli
arc setup
```

The `arc setup` step is required after npm install on any platform — it installs local shims and adds shell integration. Open a new terminal after `arc setup` on first install.

## Updating

### Bootstrap install

Re-run the same one-liner — the script is idempotent (pulls latest code, reinstalls deps, refreshes shims):

**PowerShell:**
```powershell
irm https://raw.githubusercontent.com/Codename-11/ARC/main/scripts/bootstrap.ps1 | iex
```

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/Codename-11/ARC/main/scripts/bootstrap.sh | bash
```

### npm install

```bash
npm update -g arccli
arc update
```

### From source (development)

```bash
git pull
pnpm build             # Shims point at dist/, so a rebuild is all that's needed
arc update             # Run this if shims or shell integration may have changed
```

> **What `arc update` does:** refreshes the local shims in `~/.local/bin` and rewrites shell integration. It does **not** pull or install new code.

## First Profile

### Import an existing Claude account

If you already have Claude Code configured, import it:

```bash
arc profile import --name default
```

ARC copies credentials and settings from `~/.claude` into `~/.arc/profiles/default/`.

### Create a new profile

Start the interactive wizard (runs automatically if no profiles exist):

```bash
arc
```

Once profiles exist, `arc` opens the **TUI dashboard** where you can navigate, switch, and launch profiles interactively.

Or create directly:

```bash
arc create work --tool claude --auth-type oauth
arc launch work          # Opens Claude Code — authenticate on first run
```

### Multi-tool example

```bash
arc create claude-work --tool claude --auth-type oauth
arc create gemini-work --tool gemini --auth-type api-key
arc set-key gemini-work

arc use claude-work
arc launch               # launches claude

arc use gemini-work
arc launch               # launches gemini
```

## Next Steps

- [Profiles](./profiles.md) — manage multiple accounts across tools
- [Authentication](./authentication.md) — API keys, Bedrock, Vertex AI, Foundry
- [Shell Integration](./shell-integration.md) — make tool commands automatically use the active profile
