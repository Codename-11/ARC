# ARC Daemon

The **ARC daemon** (`@axiom-labs/arc-daemon`) is the long-running local
service that hosts agents, profiles, chat rooms, orchestration loops, and
the wire-protocol endpoint. All other surfaces — TUI, CLI commands, web
dashboard, future Electron and mobile apps, and the self-hosted relay — are
thin clients of the daemon.

> **Source of truth:** [`docs/plans/arc-v3-daemon.md`](./plans/arc-v3-daemon.md).
> This doc stays in lock-step with the Phase 1–3 sections of that plan.

- **Default bind:** `127.0.0.1:7272`
- **Protocol:** see [protocol.md](./protocol.md)
- **Data home:** `~/.arc/` (overrideable via `ARC_DIR`)

## Lifecycle commands

The CLI wires daemon lifecycle management under the `arc daemon` group.

| Command                               | Purpose                                              |
|---------------------------------------|------------------------------------------------------|
| `arc daemon start`                    | Start the daemon, detached (default)                 |
| `arc daemon start --foreground`       | Start in the foreground; blocks the terminal        |
| `arc daemon start --port <n>`         | Override bind port (same effect as `ARC_PORT=<n>`)   |
| `arc daemon stop`                     | Send SIGTERM and wait for clean exit                 |
| `arc daemon restart [--port <n>]`     | Stop, wait, start                                    |
| `arc daemon status [--json]`          | Print running pid + host + port, or `stopped`        |
| `arc daemon logs [-n <N>] [--tail]`   | Print the last N lines; `--tail` follows             |

The detached form re-execs the current Node binary with the same CLI args
plus `--foreground`, `stdio: "ignore"`, and `detached: true`, then blocks
on the PID file appearing (up to 5 s).

## Environment variables

| Variable     | Effect                                                                          |
|--------------|---------------------------------------------------------------------------------|
| `ARC_DIR`    | Override the ARC home directory (default: `~/.arc`). Controls where the daemon writes `arc.db`, `daemon.log`, `daemon.pid`, and `auth.json`. |
| `ARC_PORT`   | Override the bind port (default `7272`). `--port` on the CLI wins.              |
| `ARC_HOST`   | Override the bind host (default `127.0.0.1`). Loopback is strongly recommended. |

The daemon refuses any HTTP/WebSocket request whose `Host` header is not
loopback (`127.0.0.1`, `localhost`, `::1`) plus the configured port. This
is the first line of defence against DNS rebinding.

## Filesystem layout

On first start the daemon creates:

```
~/.arc/
  arc.db        # SQLite — agents, events, chat, loops, handoffs, clients, meta
  auth.json     # 0600 — { v: 1, rootToken }
  daemon.pid    # PID of the running daemon (cleared on clean shutdown)
  daemon.log    # JSONL structured log
```

`arc.db` is the canonical runtime store. Its schema (`clients`, `agents`,
`agent_events`, `chat_rooms`, `chat_messages`, `loops`, `handoffs`, `meta`)
is created from
[`packages/daemon/src/db/migrations/001_init.sql`](../packages/daemon/src/db/migrations/001_init.sql).
Profile configuration stays in `~/.arc/config.json` for now; later phases
may migrate it into SQLite.

`auth.json` contains the **root token** that local clients use for
bootstrap. It is generated on first start with 32 bytes of CSPRNG entropy,
written with `0600` permissions, and rotated by simply deleting the file.

## Health check

Over HTTP:

```bash
curl -s http://127.0.0.1:7272/health | jq
```

Returns `DaemonHealth`:

```jsonc
{
  "ok": true,
  "version": "1.0.0-alpha.0",
  "protocol": 1,
  "uptime_ms": 42113,
  "pid": 24580,
  "host": "127.0.0.1",
  "port": 7272
}
```

Over the wire protocol the same payload comes back from the `health.get`
method (no auth required — see [protocol.md](./protocol.md)).

## PID file semantics (`readPid`)

The `readPid(pidPath)` helper (exported from
[`packages/daemon/src/bootstrap.ts`](../packages/daemon/src/bootstrap.ts))
is what both `arc daemon status` and `arc daemon start` consult before
doing anything destructive:

1. Read and parse `daemon.pid`. If missing or not a finite positive
   integer, return `null` (treated as "not running").
2. Call `process.kill(pid, 0)` as a liveness probe — this sends no signal
   but errors on an unknown pid. If it throws, the pidfile is stale and
   `null` is returned; otherwise the parsed pid is returned as-is.

A `null` return from `readPid` means "it is safe to start a new daemon".
`start` refuses if `readPid` is non-null; `stop` exits early with a
friendly message in the same case.

## Pairing additional clients

> This CLI subcommand is planned for Phase 10 ("Self-hosted relay") but
> the underlying primitive (`pairClient` in
> [`packages/daemon/src/auth.ts`](../packages/daemon/src/auth.ts)) is
> already shipped. See the plan for the final UX.

The intended flow:

```bash
arc daemon pair --label "laptop-tui"
# prints a one-time bearer token (hex, 64 chars).
# Hand it to the client via QR, paste, or pairing-code flow.
```

Server-side this inserts a row into the `clients` table with
`sha256(token)` as the `token_hash` and the label as metadata. Clients
present the token on their first `auth.login` call.

Tokens are one-time to the operator: revoke by deleting the row
(`arc daemon revoke <client-id>` in the same planned CLI group) or
dropping `auth.json` to rotate the root token.

## Troubleshooting

### `EADDRINUSE: address already in use 127.0.0.1:7272`

Something else holds the port. Options:

1. `arc daemon status` — if it prints `running`, you already have a
   daemon. Use the existing one.
2. Kill the process manually:
   - Linux/macOS: `lsof -iTCP:7272 -sTCP:LISTEN`
   - Windows: `netstat -ano | findstr :7272`
3. Bind elsewhere: `ARC_PORT=7273 arc daemon start` (all clients must
   then use the same port).

### Stale `daemon.pid`

`readPid` tolerates stale pidfiles automatically (see
[above](#pid-file-semantics-readpid)). If status insists a daemon is
running but connects fail, verify the process is actually alive; if not,
`rm ~/.arc/daemon.pid` and try again. The daemon also clears the pidfile
on clean shutdown.

### `daemon did not start within 5000ms`

`arc daemon start` waits up to 5 s for the detached child to write
`daemon.pid`. If it times out, inspect `daemon.log` for a bind failure,
SQLite lock, or missing migrations. Running `arc daemon start
--foreground` surfaces errors to your terminal directly.

### `unauthorized` on every request

Either the session did not call `auth.login`, or the token does not match
`rootToken` in `~/.arc/auth.json` / any paired client row. Re-read the
token from the auth file, or rotate it by deleting `auth.json` (all paired
clients keep working; only local "root" access regenerates).

### Mismatched protocol version

Clients sending `v` other than `1` in an envelope are rejected with
`bad_request`. This means a client is pinned to a future protocol
revision; pin it to `1` for now (the only shipped version). See
[protocol.md](./protocol.md#versioning-and-backward-compat) for the
compatibility rules.

## Further reading

- [Architecture](./architecture.md) — how the daemon fits into the wider
  control plane.
- [Wire protocol](./protocol.md) — frame format, envelopes, method catalog.
- [v2 → v3 migration](./v2-to-v3-migration.md) — how to move an existing
  `~/.arc/` onto the daemon.
- Plan of record: [`docs/plans/arc-v3-daemon.md`](./plans/arc-v3-daemon.md).
