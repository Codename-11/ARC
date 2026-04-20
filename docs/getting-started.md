# Getting Started

> **ARC v3 in progress.** `1.0.0-alpha.0` pivots ARC to a **daemon-first**
> architecture — `arc daemon start` is now the default way to run ARC.
> The plan of record is [`docs/plans/arc-v3-daemon.md`](./plans/arc-v3-daemon.md);
> a deeper walk-through lives in [architecture.md](./architecture.md). If
> you are coming from v2, read [v2-to-v3-migration.md](./v2-to-v3-migration.md)
> first.

## Requirements

- **Node.js 20+**
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
irm https://raw.githubusercontent.com/Codename-11/ARC/master/scripts/bootstrap.ps1 | iex
```

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/Codename-11/ARC/master/scripts/bootstrap.sh | bash
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
npm install -g @axiom-labs/arc-cli
arc setup
```

The `arc setup` step is required after npm install on any platform — it installs local shims and adds shell integration. Open a new terminal after `arc setup` on first install.

## Updating

### Bootstrap install

Re-run the same one-liner — the script is idempotent (pulls latest code, reinstalls deps, refreshes shims):

**PowerShell:**
```powershell
irm https://raw.githubusercontent.com/Codename-11/ARC/master/scripts/bootstrap.ps1 | iex
```

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/Codename-11/ARC/master/scripts/bootstrap.sh | bash
```

### npm install

```bash
npm update -g @axiom-labs/arc-cli
arc update
```

### From source (development)

```bash
git pull
pnpm install:local     # Rebuild + refresh shims (idempotent)
```

See [Development](./development.md) for the full local dev workflow.

## Run ARC

In v3 ARC runs as a **persistent local daemon**. Every UI — TUI, CLI,
web dashboard, Electron desktop, mobile app, or the self-hosted relay —
is a thin client of this daemon and speaks the same
[wire protocol](./protocol.md).

### Start the daemon

```bash
arc daemon start          # detached by default
arc daemon status         # → daemon: running (pid NNNN) on 127.0.0.1:7272
arc daemon stop
arc daemon logs --tail
```

Once running, everything else connects over `ws://127.0.0.1:7272`.
The daemon owns every agent process, so closing a client does not kill
agents — agents now survive UI disconnect.

### Launch a UI

```bash
arc                       # TUI (Ink) — connects to the running daemon
arc web                   # open the web dashboard in your browser
arc chat                  # interactive REPL over the active profile
arc status                # one-shot profile + daemon status
```

If a client RPC cannot reach the daemon, start one with
`arc daemon start` first. A planned auto-probe (Phase 1 of the v3
plan) will spawn a detached daemon transparently when none is running.

### `ARC_PORT`

The daemon binds to `127.0.0.1:7272` by default. Override with either an
environment variable or the `--port` flag — the flag always wins:

```bash
ARC_PORT=7373 arc daemon start
# …or equivalently:
arc daemon start --port 7373
```

Every client picks up the same `ARC_PORT` automatically, so a single
`export ARC_PORT=7373` in your shell configures the whole stack.

### `ARC_DIR`

All daemon state lives under `~/.arc/` — SQLite (`arc.db`), the root
token (`auth.json`), the structured log (`daemon.log`), and the PID
file (`daemon.pid`). Point ARC at a different directory by setting
`ARC_DIR`:

```bash
ARC_DIR=/opt/arc arc daemon start
```

This is useful for per-project isolation, headless server installs, or
running ARC out of a Docker volume. See the
[daemon operator guide](./daemon.md) for the full filesystem layout and
pairing additional clients.

### Relationship between daemon and TUI

Before v3 the TUI **was** ARC — it owned every agent lifecycle, and
quitting the TUI killed them all. In v3 the TUI is just a renderer for
state that lives in the daemon. The same is true for the web dashboard,
Electron app, mobile client, and CLI commands. You can swap any of them
in and out freely; the daemon keeps going.

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
- [Daemon operator guide](./daemon.md) — lifecycle, env vars, log location,
  `readPid` semantics
- [Architecture](./architecture.md) — how the daemon, client SDK, and
  adapters fit together
- [Wire protocol](./protocol.md) — frame format, envelope, method catalog

---

## v2 deprecation notice

Everything **below ARC v3** — the pre-daemon 0.x series — still runs, but
is no longer the supported install path. v2 (`0.4.x`) is frozen at the
`archive/v0.4.x` tag for anyone who needs to reproduce the old behaviour.
Moving an existing install forward takes one command:

```bash
arc migrate v2-to-v3
```

See [v2-to-v3-migration.md](./v2-to-v3-migration.md) for the full guide,
including backup, rollback, and what survives versus what changes.
