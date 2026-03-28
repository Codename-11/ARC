# Contributing to ARC

Thanks for your interest in contributing to ARC! This document covers the basics for getting started.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) (any recent version; the repo pins via `packageManager`)

## Setup

```bash
git clone https://github.com/Codename-11/ARC.git
cd ARC
pnpm install
pnpm build
```

## Development

```bash
pnpm cli:dev -- --help       # Run from source (no build step)
pnpm dev:tui                 # Run TUI dashboard from source
pnpm dev:tui:watch           # TUI with hot-reload on file change
pnpm dev:watch               # Rebuild on file change
pnpm typecheck               # Strict TypeScript check
pnpm build                   # Production build
```

## Branch Conventions

| Prefix | Use |
|--------|-----|
| `feature/<name>` | New features |
| `fix/<name>` | Bug fixes |
| `docs/<name>` | Documentation only |

## Commit Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add workspace-aware profile selection
fix: prevent credential leak on profile switch
docs: update shell integration guide
refactor: extract auth adapter interface
chore: bump dependencies
```

## Pull Request Checklist

Before submitting a PR, please ensure:

- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds
- [ ] You've tested your changes locally (`pnpm cli:dev`)
- [ ] Commit messages follow Conventional Commits
- [ ] CHANGELOG.md is updated for user-facing changes

## Project Structure

```
src/
  index.ts          # Entry point
  cli.ts            # Command registration (Commander.js)
  version.ts        # Single source of truth for version
  config.ts         # Config load/save
  auth.ts           # Credential detection and env building
  shared.ts         # Shared layer sync/unsync
  types.ts          # TypeScript interfaces
  commands/         # CLI command handlers
  tui/              # Ink/React TUI components and views
scripts/            # Bootstrap, version, and lifecycle scripts
docs/               # User-facing documentation
```

## Versioning

This project follows [Semantic Versioning](https://semver.org/). Use the version script to bump:

```bash
node scripts/version.js 0.2.0-beta
```

This updates `package.json` and `src/version.ts` in one step.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
