# ARC Wire Protocol (v1)

The ARC v3 daemon exposes a single, versioned, binary-multiplexed WebSocket
protocol. Every client — TUI, CLI, web dashboard, Electron desktop, mobile,
or a future relay — speaks the same wire format.

> **Source of truth:** [`docs/plans/arc-v3-daemon.md`](./plans/arc-v3-daemon.md) and
> [`packages/client/src/protocol.ts`](../packages/client/src/protocol.ts).
> This document is kept in sync with those by hand. If they disagree, the code wins.

- **Protocol version:** `1`
- **Transport:** WebSocket (RFC 6455) over loopback TCP, or tunnelled over the
  self-hosted relay.
- **Default port:** `7272` (override with `ARC_PORT`).
- **Framing:** custom binary mux — one frame per WebSocket binary message.
- **Control encoding:** UTF-8 JSON, validated against Zod schemas.

## Frame format

Each binary message on the socket carries exactly one frame:

```
 ┌──────┬───────┬──────────────┬────────────────────┐
 │  ch  │ flags │  len (u32be) │  payload (N bytes) │
 │  1B  │  1B   │     4B       │                    │
 └──────┴───────┴──────────────┴────────────────────┘
```

- `ch` — channel id (see table below).
- `flags` — bit 0 (`0x01`) set when the frame is part of a fragmented sequence;
  bits 1–7 are reserved and must be 0.
- `len` — payload length, big-endian `uint32`.
- `payload` — `len` bytes, interpreted per-channel.

WebSocket already length-prefixes its own messages; the frame header is kept
so the format remains self-describing over other transports (TCP, relay
channels). Implementations live in
[`packages/client/src/frame.ts`](../packages/client/src/frame.ts) and are
shared between daemon and client.

### Channels

| Id     | Name       | Payload              | Status       |
|--------|------------|----------------------|--------------|
| `0x00` | Control    | JSON envelope (UTF-8)| Shipped (v1) |
| `0x01` | Terminal   | Raw bytes (PTY pass-through) | Reserved (Phase 4) |
| `0x02` | File       | Chunk transfer       | Reserved (Phase 12+) |
| `0x03` | Audio      | Opus / PCM frames    | Reserved (Phase 12+) |

All other channel ids (`0x04`–`0xFF`) are reserved. Clients must ignore
unknown channels silently; servers must refuse to emit them.

## Control envelope

Every control-channel frame is a JSON-encoded envelope validated against the
Zod schema in
[`packages/client/src/protocol.ts`](../packages/client/src/protocol.ts):

```ts
const Envelope = z.object({
  v:       z.literal(1),
  id:      z.string(),
  type:    z.enum([
    "request",
    "response",
    "event",
    "subscribe",
    "unsubscribe",
    "error",
  ]),
  method:  z.string().optional(),   // request only
  params:  z.unknown().optional(),  // request only
  result:  z.unknown().optional(),  // response only
  topic:   z.string().optional(),   // subscribe / unsubscribe / event
  payload: z.unknown().optional(),  // event only
  code:    z.string().optional(),   // error only
  message: z.string().optional(),   // error only
});
```

### Envelope rules

- `v` must be `1`. Envelopes that fail schema validation (wrong `v`,
  missing required field, wrong type) are silently dropped by the
  server and logged as `frame.invalid-envelope`.
- `id` is chosen by the sender. Every `response` or `error` quotes the
  `id` of the request it answers.
- Clients originate `request`, `subscribe`, `unsubscribe`. The server
  originates `response`, `event`, `error`.
- Envelopes the server does not expect (e.g. a `response` from a client)
  are silently dropped.

## Authentication

1. Client opens the WebSocket.
2. Client sends `auth.login` as its first request (see
   [Method catalog](#method-catalog)).
3. Server validates the token against `rootToken` in `~/.arc/auth.json` or
   the hashed token of a paired client in the `clients` table.
4. On success the session is flagged authenticated and the returned
   `sessionId` is used for logging and topic routing.
5. All methods other than `auth.login` and `health.get` require an
   authenticated session. Calling them earlier returns `unauthorized`.

## Method catalog

The authoritative list of v1 methods lives in the `Methods` export of
`packages/client/src/protocol.ts`. Each method takes typed params and
returns a typed result; both are Zod-validated on the boundary.

| Method          | Auth? | Params                                        | Result                                                                        |
|-----------------|-------|-----------------------------------------------|-------------------------------------------------------------------------------|
| `auth.login`    | No    | `AuthLoginParams`                             | `AuthLoginResult`                                                             |
| `health.get`    | No    | –                                             | `HealthGetResult`                                                             |
| `profile.list`  | Yes   | –                                             | `ProfileListResult`                                                           |
| `profile.get`   | Yes   | `{ name: string }`                            | Profile (shape deferred — returned as unknown)                                |
| `agent.list`    | Yes   | –                                             | `AgentListResult`                                                             |
| `agent.run`     | Yes   | `AgentRunParams`                              | `AgentRunResult` (Phase 4 lands the real handler)                             |
| `agent.stop`    | Yes   | `AgentStopParams`                             | `AgentOkResult` (Phase 4)                                                     |
| `agent.send`    | Yes   | `AgentSendParams`                             | `AgentOkResult` (Phase 4)                                                     |

### Schemas

```ts
// auth.login
AuthLoginParams = { token: string }                 // min length 16
AuthLoginResult = {
  sessionId:     string;
  clientId:      string;
  serverVersion: string;
  protocol:      1;
}

// health.get
HealthGetResult = {
  ok:        true;
  version:   string;
  protocol:  1;
  uptime_ms: number;
  pid:       number;
  host:      string;
  port:      number;
}

// profile.list
ProfileSummary     = { name: string; tool: string; active?: boolean }
ProfileListResult  = { profiles: ProfileSummary[] }

// agent.list
AgentSummary = {
  id:          string;
  profile:     string;
  cwd:         string;
  status:      string;   // starting | running | idle | stalled | completed | failed
  launchMode:  string;   // native | worker
  createdAt:   number;   // ms since epoch
  updatedAt:   number;
  completedAt?: number | null;
  worktree?:    string | null;
}
AgentListResult = { agents: AgentSummary[] }

// agent.run  (Phase 4 executes; Phase 2 returns `unimplemented`)
AgentRunParams = {
  profile:    string;
  prompt?:    string;
  cwd?:       string;
  worktree?:  string;
  launchMode?: "native" | "worker";
}
AgentRunResult = { agentId: string }

// agent.stop / agent.send
AgentStopParams = { agentId: string }
AgentSendParams = { agentId: string; text: string }
AgentOkResult   = { ok: true }
```

Planned methods for later phases (documented here so clients can plan):

| Method                                                                                   | Phase |
|------------------------------------------------------------------------------------------|-------|
| `profile.create` / `profile.update` / `profile.delete` / `profile.clone` / `profile.switch` | 4     |
| `agent.attach` / `agent.archive`                                                         | 4     |
| `chat.post` / `chat.read` / `chat.wait`                                                  | 7     |
| `loop.start` / `loop.status` / `loop.stop`                                               | 6     |
| `handoff.create` / `handoff.list`                                                        | 9     |
| `roundtable.start` / `roundtable.join`                                                   | 9     |
| `doctor.run` / `doctor.fix`                                                              | 4     |

## Subscriptions and topics

Clients subscribe to a topic by sending:

```jsonc
{ "v": 1, "id": "...", "type": "subscribe", "topic": "agent:abc" }
```

Server acknowledges with a `response` carrying `{ ok: true, topic }` and
begins pushing `event` envelopes for that topic. Unsubscribing is
symmetrical. A connection drop drops all subscriptions; on reconnect the
client is expected to re-subscribe (the reference SDK does this
automatically).

| Topic            | Emitted when                                        |
|------------------|-----------------------------------------------------|
| `agents`         | High-level list churn (run / stop / archive)        |
| `agent:<id>`     | Every event for one agent (stdout, status, tool use)|
| `profiles`       | Profile registry changes                            |
| `chat:<room>`    | Chat room messages (Phase 7)                        |
| `loop:<id>`      | Worker/verifier loop transitions (Phase 6)          |
| `daemon`         | Daemon health / status changes                      |

Topic names are strings; dynamic variants (`agent:<id>`, `chat:<room>`,
`loop:<id>`) are built with helpers from `Topics` in
[`packages/client/src/protocol.ts`](../packages/client/src/protocol.ts).

## Errors

Errors are envelopes with `type: "error"`, a quoted `id`, a short `code`,
and a human-readable `message`. The current set:

| Code             | Meaning                                                         |
|------------------|-----------------------------------------------------------------|
| `unauthorized`   | Session is not authenticated, or the presented token is invalid |
| `bad_request`    | Envelope failed schema validation or was missing required fields|
| `not_found`      | Target entity (profile, agent, room) does not exist             |
| `internal`       | Unclassified server-side error                                  |
| `unimplemented`  | Method known but the handler is a stub (lands in a later phase) |

Clients must tolerate unknown error codes — new codes may appear in later
minors.

## Versioning and backward-compat

The protocol version bumps only on breaking changes. v1 establishes the
following contract between server and client:

- **Never remove a method.** Deprecate by replacing its handler with a
  response that still validates, or bump to v2.
- **Never narrow a schema.** `.optional()` fields may be added, but
  required fields cannot be added or their types tightened.
- **Never reuse an error code** with a different meaning; add a new one.
- **Additive events are free.** A new topic does not bump the version.
- **Channel ids are frozen** at this document's revision. New channels
  take the next free id.

Clients should pin to a major protocol version (`v: 1`) and treat new
optional fields / new events as non-breaking. Servers reject envelopes
with a mismatched `v`.

## Reference implementations

- Frame codec: [`packages/client/src/frame.ts`](../packages/client/src/frame.ts)
- Envelope + method catalog: [`packages/client/src/protocol.ts`](../packages/client/src/protocol.ts)
- Daemon RPC handlers: [`packages/daemon/src/rpc/`](../packages/daemon/src/rpc)
- Router: [`packages/daemon/src/router.ts`](../packages/daemon/src/router.ts)
- High-level client: [`packages/client/src/client.ts`](../packages/client/src/client.ts)
