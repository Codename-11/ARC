# Contributing

ARC is open source. Contributions are welcome.

## Quick Links

- [CONTRIBUTING.md](https://github.com/Codename-11/ARC/blob/master/CONTRIBUTING.md) — full contributor guide
- [GitHub Issues](https://github.com/Codename-11/ARC/issues) — bug reports and feature requests
- [GitHub Discussions](https://github.com/Codename-11/ARC/discussions) — questions and community discussion

## Development Setup

```bash
git clone https://github.com/Codename-11/ARC.git
cd ARC
pnpm install
```

## Common Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev:docs` | Run docs site locally |
| `pnpm test` | Run all tests |
| `pnpm build` | Production build |
| `pnpm typecheck` | TypeScript strict check |
| `pnpm cli:dev -- --help` | Run CLI from source |

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
