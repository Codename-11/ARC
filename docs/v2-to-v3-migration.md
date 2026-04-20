# Migrating from ARC v2 to v3

ARC v3 pivots from a collection of short-lived CLI invocations to a
persistent local **daemon** (see [architecture.md](./architecture.md)).
Your existing profiles, credentials, and shared layer are preserved; what
changes is **who owns the agent** — the daemon, not the UI.

> **Source of truth:** [`docs/plans/arc-v3-daemon.md`](./plans/arc-v3-daemon.md).
> This guide covers the end-user migration path. Implementation details
> live in the plan.

- **Current stable:** `0.4.x` (v2)
- **In progress:** `1.0.0-alpha.0` (v3)
- **Pre-daemon archive tag:** `archive/v0.4.x` — recoverable at any time.

## TL;DR

```bash
# 1. Back up
cp -r ~/.arc ~/.arc.v2-backup

# 2. Upgrade ARC itself
npm install -g @axiom-labs/arc-cli@next

# 3. Migrate the data layout
arc migrate v2-to-v3

# 4. Start the daemon
arc daemon start
arc daemon status
```

If anything goes wrong, roll back with
`rm -rf ~/.arc && mv ~/.arc.v2-backup ~/.arc && npm install -g @axiom-labs/arc-cli@0.4`.

## 1. Back up `~/.arc/`

The whole ARC data home sits under `~/.arc/` (or `$ARC_DIR` if you set
it). Copy the directory wholesale:

```bash
# Linux / macOS
cp -r ~/.arc ~/.arc.v2-backup
```

```powershell
# Windows (PowerShell)
Copy-Item -Recurse $env:USERPROFILE\.arc $env:USERPROFILE\.arc.v2-backup
```

Both `arc.db` (v3) and the older JSON stores (v2) are worth keeping; the
migration is designed to be idempotent but backups are free.

## 2. Upgrade the CLI

### npm

```bash
npm install -g @axiom-labs/arc-cli@next
```

### From source

```bash
cd ARC
git fetch
git checkout feature/v3-foundation
pnpm install
pnpm install:local   # refresh shims
```

Check you have the v3 CLI:

```bash
arc --version
# → 1.0.0-alpha.0
arc daemon --help
```

## 3. Run the migration

```bash
arc migrate v2-to-v3
```

> The migration tool lands in Phase 14 of the v3 plan. On pre-release
> builds you can skip it — the daemon will read `~/.arc/config.json` as
> before and lazy-populate `arc.db` as agents run. On stable v3 you must
> run it once.

What the migration does:

- Creates `~/.arc/arc.db` from
  [`packages/daemon/src/db/migrations/001_init.sql`](../packages/daemon/src/db/migrations/001_init.sql).
- Ingests `~/.arc/history.json` → `agents` + `agent_events` tables.
- Ingests per-profile `chat-sessions/` → `chat_rooms` + `chat_messages`.
- Ingests `~/.arc/activity.log` into the audit trail.
- Writes a fresh `~/.arc/auth.json` (root token) if one does not already
  exist.

## 4. Start the daemon

```bash
arc daemon start
arc daemon status
# → daemon: running (pid NNNN) on 127.0.0.1:7272
```

See the [daemon operator guide](./daemon.md) for environment variables,
logs, and troubleshooting.

## What survives

- **Profiles.** `~/.arc/config.json` remains the authoritative profile
  registry. Every profile, auth account, active-profile pointer, shared
  layer mapping, and per-profile tool config dir is preserved.
- **Credentials.** Keyring entries and plaintext fallbacks are untouched.
  Hot-swap snapshots under `~/.arc/credentials/` continue to work.
- **Shared layer.** `~/.arc/shared/` (MCP servers, CLAUDE.md, memory,
  projects) migrates verbatim. Sync semantics are unchanged.
- **Skills, tasks, secrets.** Their JSON stores are read-for-read by the
  daemon until Phase 4 moves them into SQLite.
- **Chat sessions.** Existing `~/.arc/profiles/<name>/chat-sessions/*.json`
  files are copied into the `chat_rooms` / `chat_messages` tables during
  `arc migrate v2-to-v3`.

## What changes

- **Agent ownership.** In v2 the TUI or CLI spawned the agent directly; in
  v3 the daemon does. Closing the UI no longer kills the agent.
- **Chat / roundtable entry points.** `arc chat` and `arc roundtable`
  connect to the daemon over the wire protocol instead of running the
  session in-process. Set `ARC_PORT` if your daemon binds non-default.
- **Dashboard wire format.** The web dashboard used to speak a bespoke
  REST + WebSocket API. Once it migrates onto `@axiom-labs/arc-client`
  (Phase 4 of the v3 plan) it will use the same binary-mux WebSocket
  every other client uses and point at the daemon on `:7272` instead of
  its standalone `:3700` port.
- **Version scheme.** v2 was `0.x`; v3 is `1.x`. `0.4.x` installs keep
  working side-by-side if you pin to that version, but the data layout
  they understand is the pre-daemon one.
- **Protocol version.** Clients must pin to `v: 1` in the wire envelope.
  See [protocol.md](./protocol.md#versioning-and-backward-compat).

## What does not survive (yet)

- **Experimental remote agent registry** (`~/.arc/remote-agents.json`).
  The v3 pairing flow replaces it; entries are not auto-migrated. Pair
  each remote client with `arc daemon pair` once it lands (Phase 10).
- **Legacy dashboard cookies / localStorage.** The new dashboard issues
  fresh tokens via the auth flow; clear your browser site data for
  `http://127.0.0.1:7272` after first launch.

## Rolling back to v2

The migration is non-destructive — the v2 JSON files remain in place —
but if you want to cleanly revert the CLI as well:

```bash
# Restore the backup you made in step 1
rm -rf ~/.arc
mv ~/.arc.v2-backup ~/.arc

# Re-install the v2 CLI
npm install -g @axiom-labs/arc-cli@0.4
arc setup
```

To build v2 from source, check out the `archive/v0.4.x` tag:

```bash
git checkout archive/v0.4.x
pnpm install
pnpm install:local
```

That tag is frozen — no fixes land there — but it is always recoverable.

## Troubleshooting

### `arc daemon start` says "daemon already running"

You have a daemon (perhaps from a prior session). `arc daemon status`
confirms; use the existing one or `arc daemon stop && arc daemon start`.

### Profiles look empty after migration

`arc profile list` reads from `~/.arc/config.json`, not the database. If
the list is empty check `ARC_DIR` and the file directly — migration
never touches this file.

### `unauthorized` errors from clients

The daemon generated a fresh root token in `~/.arc/auth.json`. Clients
that cached a v2 token need to re-authenticate; the CLI does this on
first connect. The TUI prompts you through the pairing flow.

### Anything else

Check `arc daemon logs --tail`. The structured logger records every
session open, dispatch error, and protocol-validation failure. The
[daemon operator guide](./daemon.md#troubleshooting) covers the common
cases.

## Further reading

- [Architecture](./architecture.md) — how the daemon fits together.
- [Daemon operator guide](./daemon.md) — lifecycle, env vars, pairing,
  `readPid`.
- [Wire protocol spec](./protocol.md) — frame format, envelopes, method
  catalog.
- Plan of record: [`docs/plans/arc-v3-daemon.md`](./plans/arc-v3-daemon.md).
