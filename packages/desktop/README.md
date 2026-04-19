# @axiom-labs/arc-desktop

Minimal Electron shell for ARC. Spawns the local daemon, opens a window pointed
at the dashboard, and installs a tray icon with show/hide/quit.

## Quick start

```bash
pnpm install
pnpm --filter @axiom-labs/arc-desktop dev
```

That compiles `src/` to `dist/` and launches Electron. On first boot the shell
calls `startDaemon({ version })` from `@axiom-labs/arc-daemon` and polls
`http://127.0.0.1:7272/health` until it answers. Once healthy, the window loads
the dashboard served at `/`.

### Dashboard fallback

This scaffold was authored before the daemon serves dashboard assets at `/`
(that work lives in Unit 4). Until that lands, the daemon only responds to
`/health` and `/` returns 404 — so the shell falls back to the standalone
dev dashboard at `http://127.0.0.1:3700/` if it can reach it. Run
`pnpm dev:dashboard` in another terminal for the fallback to succeed.

## Commands

| Command                                         | What it does                            |
| ----------------------------------------------- | --------------------------------------- |
| `pnpm --filter @axiom-labs/arc-desktop dev`     | Build TS then launch Electron           |
| `pnpm --filter @axiom-labs/arc-desktop build`   | Compile TypeScript to `dist/`           |
| `pnpm --filter @axiom-labs/arc-desktop pack`    | Unsigned unpacked app in `dist-electron` |
| `pnpm --filter @axiom-labs/arc-desktop dist`    | Unsigned installer in `dist-electron`   |

Code signing, auto-update, and real installers are out of scope for the
scaffold.

## Tray icon

`assets/tray.png` is a placeholder 16x16 transparent PNG. Replace it with a
real icon before shipping. If the file is missing or empty the shell still
launches (it uses `nativeImage.createEmpty()`).

## Files

- `src/main.ts` — Electron main process (daemon bootstrap, window, tray).
- `src/preload.ts` — empty placeholder for a future context bridge.
- `electron-builder.yml` — minimal unsigned packaging config.
