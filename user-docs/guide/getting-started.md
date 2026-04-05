# Getting Started

## Requirements

- **Node.js 20+**
- **An agent tool** — e.g. `npm install -g @anthropic-ai/claude-code`
- **Build tools** for the native keyring module (optional — falls back to plaintext if absent):
  - **Windows** — Visual C++ Build Tools
  - **macOS** — Xcode Command Line Tools (`xcode-select --install`)
  - **Linux** — `build-essential` and `libsecret-1-dev`

## Installation

### npm (recommended)

```bash
npm install -g @axiom-labs/arc-cli
arc setup
```

The `arc setup` step installs local shims and adds shell integration. Open a new terminal afterward.

::: tip
On Windows, a new terminal is required after the first install for PATH changes to take effect.
:::

### From source

If you prefer to build from source or want to contribute:

```bash
git clone https://github.com/Codename-11/ARC.git
cd ARC
pnpm install
pnpm build
node dist/index.js setup
```

See [Contributing](/guide/contributing) for the full development setup.

## Updating

### npm install

```bash
npm update -g @axiom-labs/arc-cli
arc update
```

### From source

```bash
git pull
pnpm install
pnpm build
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
