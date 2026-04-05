# Contributing

ARC is open source. Contributions are welcome.

## Quick Links

- [GitHub Issues](https://github.com/Codename-11/ARC/issues) — bug reports and feature requests
- [GitHub Discussions](https://github.com/Codename-11/ARC/discussions) — questions and community discussion

## Development Setup

```bash
git clone https://github.com/Codename-11/ARC.git
cd ARC
pnpm install
```

::: tip
ARC uses [pnpm](https://pnpm.io/) workspaces. Install it with `corepack enable && corepack prepare pnpm@latest --activate` if you don't have it.
:::

## Development Commands

### Core

| Command | Purpose |
|---------|---------|
| `pnpm build` | Production bundle |
| `pnpm typecheck` | TypeScript strict-mode check (must pass before commit) |
| `pnpm test` | Run all tests (E2E + integration) |
| `pnpm test:watch` | Tests with hot-reload |

### CLI & TUI

| Command | Purpose |
|---------|---------|
| `pnpm cli:dev -- --help` | Run CLI from source |
| `pnpm dev:tui` | TUI dashboard from source |
| `pnpm dev:tui:watch` | TUI with hot-reload |

### Web

| Command | Purpose |
|---------|---------|
| `pnpm site:dev` | Landing site dev server |
| `pnpm dev:dashboard` | Web dashboard dev server |
| `pnpm web` | Landing site + docs concurrently |
| `pnpm web:build` | Production build (site + docs) |
| `pnpm web:preview` | Build + merge + serve on :4000 |

### Package-Level

```bash
pnpm --filter @axiom-labs/arc-core build
pnpm --filter @axiom-labs/arc-mcp test
pnpm --filter @axiom-labs/arc-dashboard dev
```

## Project Structure

ARC is a pnpm monorepo with focused packages:

```
packages/
  core/              # Types, config, profiles, sessions, hooks, telemetry (zero adapter deps)
  cli/               # CLI commands + TUI (Ink/React) — depends on core
  mcp/               # MCP server (supervision tools)
  adapter-claude/    # Claude Code adapter (SDK bridge, auth, detect, import, shared)
  adapter-openclaw/  # OpenClaw adapter (plugin manifest, hooks, tools)
  dashboard/         # Web dashboard: REST API, WebSocket, SPA frontend
site/                # React landing site (Vite + Tailwind v4)
user-docs/           # This documentation (VitePress)
```

## Branch Naming

| Prefix | Use |
|--------|-----|
| `feature/<name>` | New features |
| `fix/<name>` | Bug fixes |
| `docs/<name>` | Documentation changes |

## Commit Convention

ARC uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add profile export command
fix: resolve keyring fallback on Linux
docs: update shell integration guide
refactor: simplify adapter resolution
test: add hook timeout coverage
chore: bump dependencies
```

## Workflow

1. Fork the repo and create a branch from `master`
2. Write failing tests first (when applicable)
3. Implement the change
4. Run `pnpm typecheck && pnpm test` — both must pass
5. Open a pull request against `master`

## CI

Pull requests run the full test suite on Ubuntu. The `master` branch requires the CI check to pass before merging.
