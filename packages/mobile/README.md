# @axiom-labs/arc-mobile

Expo (managed workflow) scaffold for the ARC mobile companion app.

This is Phase 12 of the v3 daemon pivot — the initial scaffold only. It has
three screens (Agents list, Agent detail placeholder, Settings) and talks to
the ARC daemon over WebSocket using a React-Native-compatible shim around the
shared `@axiom-labs/arc-client` protocol.

## Dev loop

```bash
pnpm install                                   # from repo root
pnpm --filter @axiom-labs/arc-mobile start     # launches Expo dev server
```

From the Expo dev server you can:

- Press `i` / `a` to open iOS / Android simulators
- Scan the QR with **Expo Go** (iOS App Store / Google Play) on a real device

Web is intentionally disabled for this scaffold (would require
`react-native-web`); a web preview is a follow-up if/when we need it.

On first launch the app is unpaired. Open **Settings**, enter your daemon
host (`127.0.0.1:7272` or `ws://host:7272`) and the shared token from
`arc daemon token`, then save. The Agents list then connects and shows
what's running on the daemon.

## Typecheck

```bash
pnpm --filter @axiom-labs/arc-mobile typecheck
```

The root `pnpm typecheck` (`tsc --noEmit`) intentionally excludes
`packages/mobile/**` — React Native has its own type graph that conflicts
with the Node-flavoured root config, so mobile is typechecked by its own
`tsconfig.json`.

## WebSocket shim

`@axiom-labs/arc-client` imports the Node `ws` package, which is not
available in React Native. The mobile app therefore uses
[`src/arc-client-rn.ts`](./src/arc-client-rn.ts) — a small shim that
re-implements `connect / call / subscribe / attachTerminal` on top of
`global.WebSocket` (built into RN) while reusing the shared `protocol.ts`
and `frame.ts` exports from the SDK.

Proper cross-runtime packaging of the SDK (browser build + conditional
exports) is a Phase-4+ follow-up; the shim is intentionally small.

## Scope

**In:** boot, three screens, daemon WebSocket connection, token-based pairing,
AsyncStorage persistence.

**Out (follow-ups):** QR-code pairing, voice input, push notifications, App
Store / Play Store signing & submission, `expo prebuild` / native folders,
live terminal streaming.
