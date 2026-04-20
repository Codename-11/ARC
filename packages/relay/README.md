# @axiom-labs/arc-relay

Self-hosted, zero-knowledge WebSocket multiplexer that routes opaque bytes
between two endpoints sharing a `pairCode`.

The relay has **no crypto awareness** — payloads are forwarded verbatim.
End-to-end encryption (NaCl box) is performed by the ARC daemon and its
clients; the relay never sees plaintext.

---

## Protocol

Endpoint: `ws(s)://<relay-host>/?pair=<code>`

| Behavior | Detail |
| --- | --- |
| Pair registry | In-memory `Map<pairCode, { a, b, createdAt }>`. |
| First connect | Becomes side **A**. |
| Second connect | Becomes side **B**. |
| Third connect | Rejected with HTTP `409 Conflict`. |
| Binary frame | Forwarded verbatim to the peer side. |
| Text frame | Dropped (payloads are ciphertext, not text). |
| Disconnect | Closes the peer with code `1000` and deletes the pair. |
| TTL | Pairs that sit with only one side connected for **5 minutes** are swept; the lone socket is closed with `1001` and the entry removed. |
| Persistence | None. Restarting the process drops every live pair. |
| Logs | None of payload content. |

`GET /health` returns `{"ok": true, "pairs": <count>}` — useful for
container health checks and LB probes.

---

## Run locally

```bash
pnpm install
pnpm --filter @axiom-labs/arc-relay run build
node packages/relay/dist/cli.js start --port 8765
```

Or during development without a build:

```bash
npx tsx packages/relay/src/cli.ts start --port 8765
```

CLI:

```
arc-relay start [--port 8765] [--host 0.0.0.0]
```

---

## Run in Docker

```bash
# Build from the repo root (multi-stage, pruned to the relay workspace)
docker build -f packages/relay/Dockerfile -t arc-relay:local .

# Run
docker run --rm -p 8765:8765 arc-relay:local
```

A ready-to-edit compose example with a TLS-terminating proxy (nginx+certbot
or Caddy) lives in [`docker-compose.yml`](./docker-compose.yml). The relay
itself speaks plain `ws://`; TLS is intentionally delegated to the edge.

---

## Smoke test

With the relay running on `:8765`:

```bash
npx tsx -e "
import WebSocket from 'ws';
const a = new WebSocket('ws://127.0.0.1:8765/?pair=demo');
const b = new WebSocket('ws://127.0.0.1:8765/?pair=demo');
a.on('open', () => a.send(Buffer.from('hi-from-a')));
b.on('message', (d) => { console.log('b got', d.toString()); process.exit(0); });
setTimeout(() => process.exit(1), 3000);
"
```

Expected: `b got hi-from-a`.

---

## What the relay does **not** do

- No user accounts, tokens, or authz beyond the shared `pairCode`.
- No persistent storage — everything is in-memory.
- No TLS — terminate at a proxy or cloud LB.
- No inspection of payloads — they are opaque bytes.

Pair codes are a thin rendezvous mechanism, not a security primitive.
Authentication, integrity, and confidentiality are the endpoints' job
(NaCl box in the ARC daemon/client).

---

## Status

Part of the v3 daemon pivot — see
[`docs/plans/arc-v3-daemon.md`](../../docs/plans/arc-v3-daemon.md) Phase 10.

Actual crypto wiring between daemon ↔ client ↔ relay is tracked separately.
This package's job is routing only.
