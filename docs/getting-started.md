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

The bootstrap is the primary install path. It clones the repo, installs dependencies, runs `arc setup`, and adds shell integration in one step.

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
4. Prompts you to open a new terminal

After bootstrap, open a new terminal and confirm:

```bash
arc --help
```

### npm

```bash
npm install -g arccli
arc setup
```

The `arc setup` step is required after npm install on any platform — it installs local shims and adds shell integration.

## First Profile

### Import an existing Claude account

If you already have Claude Code configured, import it:

```bash
arc profile import --name default
```

ARC copies credentials and settings from `~/.claude` into `~/.arc/profiles/default/`.

### Create a new profile

Start the interactive wizard:

```bash
arc
```

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
