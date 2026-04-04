# Getting Started

## Requirements

- **Node.js 20+**
- **An agent tool** — e.g. `npm install -g @anthropic-ai/claude-code`
- **Build tools** for the native keyring module (optional — falls back to plaintext if absent):
  - **Windows** — Visual C++ Build Tools
  - **macOS** — Xcode Command Line Tools (`xcode-select --install`)
  - **Linux** — `build-essential` and `libsecret-1-dev`

## Installation

### Bootstrap (recommended)

The bootstrap script clones the repo, installs dependencies, runs `arc setup`, and launches the interactive setup wizard.

::: code-group

```powershell [Windows (PowerShell)]
irm https://raw.githubusercontent.com/Codename-11/ARC/master/scripts/bootstrap.ps1 | iex
```

```bash [macOS / Linux]
curl -fsSL https://raw.githubusercontent.com/Codename-11/ARC/master/scripts/bootstrap.sh | bash
```

:::

What the bootstrap does:

1. Clones or updates the repo into `~/.arc-install/repo`
2. Runs `npm install`
3. Runs `arc setup` — installs shims into `~/.local/bin`, adds to user `PATH`
4. Launches `arc` — the onboarding wizard walks you through creating your first profile

::: tip
On Windows, a new terminal is required after the first install for PATH changes to take effect.
:::

### npm

```bash
npm install -g @axiom-labs/arc-cli
arc setup
```

The `arc setup` step is required on any platform — it installs local shims and adds shell integration. Open a new terminal afterward.

## Updating

### Bootstrap install

Re-run the same one-liner. The script is idempotent — it pulls latest code, reinstalls deps, and refreshes shims.

### npm install

```bash
npm update -g @axiom-labs/arc-cli
arc update
```

### From source

```bash
git pull
pnpm install:local     # Rebuild + refresh shims
```

## First Profile

### Option 1: Onboarding Wizard

If no profiles exist, `arc` opens the onboarding wizard automatically. It detects installed tools (Claude, Gemini, Codex) and offers to import their existing configs.

```bash
arc
```

### Option 2: Import an Existing Account

If you already have Claude Code configured, import it directly:

```bash
arc profile import --name default
```

ARC copies credentials and settings from `~/.claude` into `~/.arc/profiles/default/`.

### Option 3: Create Manually

```bash
arc create work --tool claude --auth-type oauth
arc launch work          # Opens Claude Code — authenticate on first run
```

### Multi-Tool Example

```bash
# Create profiles for different tools
arc create claude-work --tool claude --auth-type oauth
arc create gemini-work --tool gemini --auth-type api-key
arc set-key gemini-work

# Switch between them
arc use claude-work
arc launch               # launches Claude Code

arc use gemini-work
arc launch               # launches Gemini CLI
```

## Verify Installation

```bash
arc doctor               # Run diagnostics
arc status               # Show all profiles and auth state
```

The doctor command checks tool installations, PATH configuration, shell integration, and keyring availability.

## Next Steps

- **[Profiles](/guide/profiles)** — manage multiple accounts across tools
- **[Authentication](/guide/authentication)** — API keys, Bedrock, Vertex AI, Foundry
- **[Shell Integration](/guide/shell-integration)** — make tool commands automatically use the active profile
