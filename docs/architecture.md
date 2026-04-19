# ARC v3 Architecture

ARC v3 is **one daemon, many mouths**. A persistent local process owns
every agent runtime, every piece of state, and the single wire protocol
everything else speaks. The CLI, TUI, web dashboard, Electron desktop app,
mobile app, and self-hosted relay are all thin clients.

> **Source of truth:** [`docs/plans/arc-v3-daemon.md`](./plans/arc-v3-daemon.md).
> This document summarises the architecture that plan puts in motion.

```
   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
   │  TUI     │  │  CLI     │  │ Dashboard│  │ Electron │  │  Mobile  │
   │  (Ink)   │  │  (short) │  │  (SPA)   │  │ (desktop)│  │  (Expo)  │
   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
        │             │             │             │             │
        └─────────────┴──────┬──────┴─────────────┴─────────────┘
                             │
                 @axiom-labs/arc-client  (SDK)
                             │
                             ▼ WebSocket binary-mux @ :7272 (local)
                             │ or NaCl-box through the relay (remote)
                             │
                    ┌────────┴────────┐
                    │   ARC Daemon    │
                    │                 │
                    │  HTTP /health ──┤
                    │  WS  binary-mux │
                    │                 │
                    │  ┌───────────┐  │
                    │  │ Router    │  │
                    │  │ Hub (subs)│  │
                    │  │ RPC       │  │
                    │  │ Agent Mgr │──┼──► adapters spawn CLIs
                    │  │ Chat      │  │     (claude / codex / gemini / ...)
                    │  │ Orchestr. │  │
                    │  │ Hook bus  │  │
                    │  │ Profile   │  │
                    │  │  registry │  │
                    │  └────┬──────┘  │
                    └───────┼─────────┘
                            │
                  ┌─────────┴──────────┐
                  │  ~/.arc/           │
                  │    arc.db  (SQLite)│
                  │    auth.json       │
                  │    daemon.log      │
                  │    daemon.pid      │
                  │    profiles/…      │
                  │    shared/…        │
                  └────────────────────┘
```

## Package responsibilities

| Package                          | Role                                                                                      |
|----------------------------------|-------------------------------------------------------------------------------------------|
| `@axiom-labs/arc-core`           | Agent adapters, agent-client, orchestration, hooks, knowledge, tool registry. **Unchanged from v2**: daemonising is purely a shell around it. |
| `@axiom-labs/arc-daemon`         | Long-running process. HTTP + WS bind, router, RPC handlers, Hub (subscriptions), SQLite, structured logger, auth. Owns every agent lifecycle. |
| `@axiom-labs/arc-client`         | Wire-protocol SDK — frame codec, Zod envelope, typed RPC wrappers, subscription helpers, auto-reconnect. Shared by every UI surface. |
| `@axiom-labs/arc-cli`            | Commander.js CLI. `arc daemon …` lifecycle commands, typed client wrappers around remote ops, legacy passthrough for v2-only commands. |
| `@axiom-labs/arc-dashboard`      | Web SPA. Reads from the daemon over WebSocket; no direct adapter spawn any more.          |
| `@axiom-labs/arc-relay`          | Stateless, zero-knowledge WebSocket multiplexer for remote daemon access. Placeholder in Phase 1 — ships in Phase 10. |
| `@axiom-labs/arc-adapter-claude` | Claude Code adapter — SDK bridge, auth, detect, import, shared.                           |
| `@axiom-labs/arc-adapter-openclaw` | OpenClaw adapter — plugin manifest, hooks, tools.                                        |
| `@axiom-labs/arc-mcp`            | ARC as an MCP server + host manager.                                                      |

## Data flow: client → daemon → adapter → agent

A typical `agents.run` request follows this path:

```
┌─ client (TUI / CLI / dashboard / mobile)
│
│  1. client.connect() → WS open → auth.login request
│                                   ← auth.login response { sessionId, ... }
│
│  2. client.agents.run({ profile, prompt, cwd, ... })
│        └─ encodes Envelope { type: "request", method: "agent.run", params }
│           as a Control frame (channel 0x00)
│           sends over the WebSocket binary message
│
▼
┌─ daemon
│
│  3. ws/connection.ts reads the binary message,
│     frame.ts decodes channel 0x00 → envelope JSON
│     Zod parses Envelope → { id, type, method, params }
│
│  4. router.ts dispatches:
│        - auth gate (requires authenticated session)
│        - rpc/agent.ts → agentRun handler
│        - handler validates AgentRunParams, writes `agents` row in SQLite,
│          tells the Agent Mgr to spawn via the profile's adapter
│
│  5. Agent Mgr (Phase 4) spawns the adapter process in worker mode,
│     attaches stdout/stderr/tool-call streams, records agent_events rows.
│
│  6. Hub fan-out:
│        - `agents` topic: list-churn event (agent started)
│        - `agent:<id>` topic: stream of stdout / status / tool-call events
│        - responses for future `agent.send` calls go back on the same sock
│
▼
┌─ subscribers
│
│  7. Any client holding a `subscribe(topic: "agent:<id>")` receives `event`
│     envelopes carrying the recorded payload — terminal frames on channel
│     0x01 bypass JSON entirely and land raw in the client's renderer.
│
└─ Client also receives the `response` envelope for request (2) with
   { agentId } as soon as the agent is registered.
```

Agent lifecycle state, event history, chat messages, and paired-client
tokens all live in `arc.db`. Restarting the daemon (or reconnecting a
client) replays state from SQLite rather than memory.

## Key properties

- **Agent survival across UI disconnect.** The daemon owns the child
  process, not the UI. Closing the TUI leaves the agent running.
- **Single protocol, many clients.** Every surface uses the same
  `@axiom-labs/arc-client` SDK. Local vs. remote is a URL difference
  only.
- **Additive-only schema.** Wire protocol rules (see
  [protocol.md](./protocol.md#versioning-and-backward-compat)) and SQLite
  migrations are additive-only inside a major version. Clients pinned to
  `v: 1` keep working as methods and topics accrete.
- **No polling.** UIs receive change events through subscriptions. There
  is no "refresh" endpoint; the daemon pushes.
- **Loopback-first security.** The daemon refuses non-loopback hosts;
  every paired client carries an argon2-hashed bearer token; remote
  access goes through the relay with NaCl-box on every frame.

## Further reading

- [Daemon operator guide](./daemon.md) — lifecycle, env vars, filesystem,
  troubleshooting.
- [Wire protocol spec](./protocol.md) — frame format, envelopes, method
  catalog, error codes, backward-compat rules.
- [v2 → v3 migration](./v2-to-v3-migration.md) — moving from the
  pre-daemon layout.
- Plan of record: [`docs/plans/arc-v3-daemon.md`](./plans/arc-v3-daemon.md).
