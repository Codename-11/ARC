# Plan: ARC v3 — One daemon, many clients

**Status:** 📋 Planning — not started
**Target release:** `1.0.0` (v3, breaking)
**Owner:** Bailey
**Last updated:** 2026-04-19

## Vision

ARC becomes a **persistent local daemon** with a single binary WebSocket protocol. The TUI, CLI, web dashboard, Electron desktop app, Android/iOS mobile app, and a self-hosted relay are all thin clients of that daemon. Agents run independently of any UI, survive UI disconnect, and can be controlled from anywhere the relay reaches.

One daemon. Many mouths. Your dev environment, everywhere.

---

## Decisions (locked 2026-04-19)

| Decision | Choice |
|---|---|
| Daemon language | **Node/TS** — reuses `packages/core` wholesale |
| Default port | **7272** (TCP, loopback by default) |
| Auth | Shared secret in `~/.arc/auth.json` + per-client tokens rotated on pair |
| Session storage | **SQLite from day one** at `~/.arc/arc.db`, canonical store |
| Relay hosting | **Self-host only** at v3 launch — no hosted `relay.arc.sh` yet |
| v2 compat | **Break freely.** No `--legacy` flag, no v1/v2 message envelopes. |
| Plan doc layout | This single file. |

---

## Ground Truth (current state, 2026-04-19)

- `packages/dashboard/src/server.ts` + `ws.ts` — raw `node:http` + hand-rolled RFC6455 WS, vanilla JS SPA. This is the **seed of the daemon**.
- `packages/core/src/` — agent adapters, agent-client, orchestration, hooks, knowledge. Process-model only; no long-running service layer.
- `packages/cli/` — Commander.js commands; each invocation is short-lived.
- `src/tui/` (Ink) — owns agent lifecycles today. Process dies → agents die.
- Storage: flat JSON under `~/.arc/` (`config.json`, per-profile session dirs, `history.json`, `activity.log`, `update-check.json`).
- Hooks + orchestration (`RoundtableOrchestrator`, `StagedWorkflowManager`, `AgentWatchdog`) live in `packages/core/src/orchestration/`. All in-process today.

What's reusable verbatim once daemonised: agent-client, adapters, orchestration, knowledge, hooks, tool registry, runAgent generator. What gets rewritten: the shell that hosts them.

---

## Target architecture

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  TUI     │  │  CLI     │  │ Dashboard│  │ Electron │  │  Mobile  │
│  (Ink)   │  │  (short) │  │  (SPA)   │  │ (desktop)│  │  (Expo)  │
└────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │             │             │             │
     └─────────────┴──────┬──────┴─────────────┴─────────────┘
                          │
                @axiom-labs/arc-client SDK
                          │
                          ▼ WebSocket binary-mux @ :7272 (local)
                          │ or via relay (remote, NaCl box)
                          │
                 ┌────────┴────────┐
                 │  ARC Daemon     │
                 │  (packages/     │
                 │   daemon)       │
                 │                 │
                 │  ┌───────────┐  │
                 │  │ Agent Mgr │──┼─► adapters spawn CLIs
                 │  │ Chat      │  │     (claude/codex/gemini/...)
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
               │    profiles/…      │
               │    shared/…        │
               └────────────────────┘
```

---

## Phase 0 — Repo prep (1 day)

- [ ] Create `packages/daemon` + `packages/client` + `packages/relay` workspace entries (empty scaffolds, TS + tsup, wired into pnpm).
- [ ] Create `packages/mobile` and `packages/desktop` placeholders (README stubs only; implementation is Phases 11–12).
- [ ] Add `FEATURES.md` section "v3 Daemon" pointing here.
- [ ] Tag `v0.4.x` branch as `archive/v2` so the pre-daemon code is recoverable.
- [ ] Bump working version to `1.0.0-alpha.0`.

---

## Phase 1 — Daemon skeleton (~1 week)

**Deliverable:** `arc daemon start` runs a persistent process that serves `/health` on :7272, writes logs to `~/.arc/daemon.log`, and can be stopped cleanly.

### Files to create

- `packages/daemon/src/bootstrap.ts` — lifecycle, signal handling, PID file, port bind.
- `packages/daemon/src/config.ts` — `$ARC_HOME` override, port override via `ARC_PORT`.
- `packages/daemon/src/logger.ts` — structured JSONL to `~/.arc/daemon.log` with rotation at 50 MB.
- `packages/daemon/src/db.ts` — SQLite init, migrations, connection pool.
- `packages/daemon/src/db/migrations/001_init.sql` — see schema below.
- `packages/daemon/src/health.ts` — reuses existing `buildHealthReport()`.
- `packages/daemon/src/server.ts` — HTTP + WS bind on :7272.
- `packages/daemon/src/index.ts` — exported `startDaemon()`.

### CLI surface (added to `packages/cli`)

```bash
arc daemon start [--port 7272] [--foreground]
arc daemon stop
arc daemon status
arc daemon restart
arc daemon logs [--tail] [--since 10m]
```

Auto-start: any `arc` invocation that needs the daemon probes `/health`; if no response, spawns `arc daemon start --detached` and waits up to 5s.

### SQLite schema (v1)

```sql
-- Profile state is still config.json-owned (for now);
-- SQLite is for runtime/session data.

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  profile TEXT NOT NULL,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL,              -- starting | running | idle | stalled | completed | failed
  launch_mode TEXT NOT NULL,         -- native | worker
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  worktree TEXT,
  metadata JSON
);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_profile ON agents(profile);

CREATE TABLE IF NOT EXISTS agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  epoch INTEGER NOT NULL,            -- each new run = new epoch, timeline appends
  seq INTEGER NOT NULL,              -- within epoch
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,                -- stdout | stderr | tool_call | tool_result | status | error
  payload JSON NOT NULL
);
CREATE INDEX idx_events_agent_epoch ON agent_events(agent_id, epoch, seq);

CREATE TABLE IF NOT EXISTS chat_rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  metadata JSON
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  author TEXT NOT NULL,              -- agent id or "user"
  reply_to INTEGER REFERENCES chat_messages(id),
  mentions JSON,                     -- ["@agent-abc", "@everyone"]
  body TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_chat_room_ts ON chat_messages(room_id, ts);

CREATE TABLE IF NOT EXISTS loops (
  id TEXT PRIMARY KEY,
  worker_profile TEXT NOT NULL,
  verify_profile TEXT,
  verify_check TEXT,
  status TEXT NOT NULL,
  iteration INTEGER DEFAULT 0,
  max_iterations INTEGER,
  max_time_ms INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  archive_path TEXT,
  metadata JSON
);

CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  from_agent TEXT,
  to_profile TEXT NOT NULL,
  template_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  label TEXT,                        -- "Bailey's phone", "laptop-tui"
  token_hash TEXT NOT NULL,          -- argon2
  paired_at INTEGER NOT NULL,
  last_seen INTEGER,
  source TEXT NOT NULL               -- local | relay
);
```

All writes go through a small query layer in `packages/daemon/src/db.ts` — no ORM.

---

## Phase 2 — Wire protocol v1 (~4 days)

**Deliverable:** versioned, tested WS protocol. All daemon ↔ client traffic flows through it.

### Frame format

```
┌────┬──────┬──────────────────────────────────┐
│ ch │ flag │ payload (length-prefixed bytes)  │
│ 1B │ 1B   │                                  │
└────┴──────┴──────────────────────────────────┘
```

- `ch`:
  - `0x00` — control (JSON, Zod-validated)
  - `0x01` — terminal bytes (raw, for agent PTY streaming)
  - `0x02` — file transfer chunks (reserved, Phase 12+)
  - `0x03` — audio (reserved, Phase 12+)
  - `0x04..0xFF` — reserved
- `flag` bit 0 = fragmented (more frames follow), bits 1–7 reserved.

Terminal bytes bypass JSON entirely — straight through to the client's renderer.

### Control message envelope

```ts
// packages/client/src/protocol.ts
export const Envelope = z.object({
  v: z.literal(1),
  id: z.string().uuid(),
  type: z.enum([
    "request", "response", "event", "subscribe", "unsubscribe", "error",
  ]),
  // for request/response
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  // for events
  topic: z.string().optional(),
  payload: z.unknown().optional(),
  // for errors
  code: z.string().optional(),
  message: z.string().optional(),
});
```

### Core methods (v1)

| Method | Purpose |
|---|---|
| `auth.login` | Bearer token → session id |
| `profile.list` / `profile.get` / `profile.create` / `profile.update` / `profile.delete` / `profile.clone` | Profile CRUD |
| `profile.switch` | Set active profile (or `null`) |
| `agent.run` | Launch an agent: `{profile, prompt?, cwd?, worktree?, launchMode?}` → `{agent_id}` |
| `agent.attach` | Subscribe to terminal + events for `agent_id` |
| `agent.send` | Push input to running agent (stdin or tool-reply) |
| `agent.stop` / `agent.archive` | Terminate / persist + remove |
| `agent.list` | Active + recent agents |
| `chat.post` / `chat.read` / `chat.wait` | Room mailbox (Phase 7) |
| `loop.start` / `loop.status` / `loop.stop` | Worker/verifier loop (Phase 6) |
| `handoff.create` / `handoff.list` | Handoff template (Phase 9) |
| `roundtable.start` / `roundtable.join` | Roundtable (Phase 9) |
| `doctor.run` / `doctor.fix` | Diagnostics |

### Topics (events)

- `agent:<id>` — all events for one agent
- `agents` — high-level list churn
- `profiles` — registry changes
- `chat:<room>` — room messages
- `loop:<id>` — loop iterations
- `daemon` — health/status

### Auth flow

```
client → { auth.login, token }
server → { ok, session_id, client_id, server_version }
all subsequent frames must carry session_id in the envelope
```

Token generation: `arc daemon pair --label "laptop-tui"` → prints token once. Stored as argon2 hash in `clients` table.

### Deliverables

- `packages/daemon/src/ws/` — bind, frame codec, channel router, Zod validation, auth middleware.
- `packages/daemon/src/rpc/` — one file per method domain (`profile.ts`, `agent.ts`, `chat.ts`, ...). Pure functions; hand in DB + runtime.
- `packages/client/src/protocol.ts` — Zod schemas shared.
- Tests: frame codec round-trip, envelope validation, method dispatch, subscription fan-out.

---

## Phase 3 — Client SDK `packages/client` (~3 days)

**Deliverable:** `@axiom-labs/arc-client`, the single SDK every surface uses.

- `ArcClient` class: connect, reconnect (exp backoff, jitter), resubscribe on reconnect.
- `call(method, params)` → Promise<result>
- `subscribe(topic, handler)` → unsubscribe fn
- `attachTerminal(agentId, sink)` → pipes channel 1 bytes directly to `sink.write()`
- Typed wrappers per domain: `client.agents.run(...)`, `client.chat.post(...)`.
- Works in Node and browser (isomorphic WS, no Node-only deps).
- Offline queue for control messages (not terminal bytes).
- Token management: reads `~/.arc/auth.json` (Node) or prompts (browser).

Published to npm as `@axiom-labs/arc-client`.

---

## Phase 4 — Port TUI, CLI, dashboard to the daemon (~2 weeks)

**Deliverable:** all existing surfaces go through the daemon. No direct adapter spawn from TUI or CLI.

### TUI

- Becomes a pure client. `arc` (no args) still opens it.
- Every view that currently reads `~/.arc/config.json` now subscribes to `profiles` + `agents` topics and calls RPC methods.
- Multiple TUIs can attach simultaneously — first user sees no lock.
- **Deleted:** direct adapter calls, in-process hooks, in-process orchestration from TUI.

### CLI — Docker-style verbs

| v2 command | v3 command |
|---|---|
| `arc launch <profile>` | `arc run <profile> [prompt]` |
| `arc launch --bare <tool>` | `arc run --bare <tool>` |
| (new) | `arc ls` — agent list |
| (new) | `arc attach <agent-id>` — live stream |
| (new) | `arc send <agent-id> "<text>"` — follow-up |
| (new) | `arc stop <agent-id>` |
| (new) | `arc archive <agent-id>` |
| (new) | `arc inspect <agent-id>` — JSON dump |
| (new) | `arc wait <agent-id>` — block until done (exit code = agent exit) |
| (new) | `arc --host <host:port>` — remote daemon |
| (new) | `arc --relay <pair-code>` — remote via relay |

Keep: `arc profile`, `arc provider`, `arc doctor`, `arc chat`, `arc roundtable`, `arc instructions`, `arc backup`, `arc swap`. All reimplemented as client calls.

### Dashboard

- Drops its server-side state. All fetches become subscriptions.
- Permission-mode toggle → RPC.
- Reuses existing 13 view components; swap their data sources.

### Deliverables

- `packages/cli/src/commands/*.ts` — refactored to use `ArcClient`.
- `packages/dashboard/public/components/*.js` — swap data layer.
- `src/tui/` — swap data layer.
- Smoke test: fresh `~/.arc/`, `arc daemon start`, `arc run claude`, `arc ls`, `arc attach <id>`, `arc stop <id>`.

---

## Phase 5 — Provider `extends` (~2 days)

**Deliverable:** `ProviderConfig.extends` lets a profile inherit a builtin adapter and override env/models.

- `ProviderConfig.extends: "claude" | "codex" | "gemini" | "opencode"`.
- `resolveProfile()` merges base + override.
- Ship presets: Z.AI / GLM-4.6, Alibaba Qwen, DeepSeek-via-claude-adapter, `claude-work` vs `claude-personal` multi-account template.
- `arc provider presets` lists them.
- Migrates cleanly: existing `openai-compat` profiles keep working; new profiles can opt into `extends`.

---

## Phase 6 — `arc loop` (~1 week)

**Deliverable:** worker/verifier iteration loop, cross-provider by default.

```bash
arc loop run \
  --worker claude-opus \
  --prompt "implement X" \
  --verify-provider codex-gpt5 \
  --verify "does this pass acceptance?" \
  --verify-check "npm test" \
  --max-iterations 10 \
  --max-time 2h \
  --archive
```

Semantics:

1. Spawn worker with prompt.
2. On worker completion, run `verify-check` (shell). If green, done.
3. Else spawn verify agent with the prompt + worker's diff; if verify agent says "good", done.
4. Else feed verify agent's critique back to worker as follow-up, increment iteration.
5. Hit `--max-iterations` or `--max-time` → archive + exit.

Storage: `~/.arc/loops/<id>/` with `meta.json`, `iter-01/worker.log`, `iter-01/verify.log`, etc. Mirrored into `loops` table.

WS event: `loop:<id>` streams iteration transitions.

Dashboard view: `/loops` — live list + per-loop transcript.

---

## Phase 7 — Chat rooms primitive (~1 week)

**Deliverable:** async multi-agent mailbox with mentions.

### CLI

```bash
arc chat create <room>
arc chat post <room> "message text" [--as @agent-id] [--reply-to <msg-id>]
arc chat read <room> [--since 10m] [--mentions-only]
arc chat wait <room> --mentioning @me [--timeout 10m]
arc chat rooms                        # list
```

### Agent integration

When launched under the daemon, every agent receives `ARC_AGENT_ID` + `ARC_CHAT_ROOMS` (comma-separated rooms it's a member of). An ARC MCP tool `arc_chat_read` / `arc_chat_post` makes the rooms callable from inside agents.

Mentions: `@<agent-id>`, `@everyone`, `@humans`. Stored in `chat_messages.mentions` JSON. Wait-style subscription fires when a matching mention lands.

### Why this complements roundtable

Roundtable is synchronous turn-based consensus. Chat rooms are the async substrate — long-running agents can leave notes, ask questions, get picked up when the other agent is free. Roundtable can optionally use a chat room as its transport for fully-async sessions.

---

## Phase 8 — Worktree as first-class (~3 days)

**Deliverable:** worktrees are tracked per-agent, archived on completion.

```bash
arc run --worktree feature-x --base master claude "implement X"
arc worktree ls
arc worktree archive feature-x
arc worktree gc                       # remove worktrees whose agents are done
```

Implementation: `agents.worktree` column stores path + base branch. Daemon creates via `git worktree add` pre-launch, archives or removes on `agent.archive`. Dashboard Profiles view gains a worktree indicator per running agent.

---

## Phase 9 — Enhanced roundtable + handoff (~4 days)

**Deliverable:** committee mode, handoff command, plan-file-on-disk, self-scheduled heartbeat.

### Committee mode

```bash
arc roundtable --mode committee --agents opus-thinking,gpt5-medium \
  "root cause this bug" --no-edits
```

Analysis-only. Both agents launched with `--no-edits` wrapper prompt. Kept alive post-plan for drift review (new message triggers re-analysis).

### Handoff

```bash
arc handoff <from-agent-id> <to-profile> [--template full|short]
```

Writes `~/.arc/handoffs/<id>.md` with sections: **Task / Context / Relevant Files / Current State / What Was Tried / Decisions / Acceptance Criteria / Constraints**. Pulls context from the source agent's event log. Passes as first prompt to the receiver.

### Plan-file-on-disk

`StagedWorkflowManager` writes `~/.arc/plans/<slug>.md`. Each phase transition re-reads it. Survives context compaction across long runs.

### Self-scheduled heartbeat

Replace `AgentWatchdog` timer-based nudge with a **self-prompt re-entry** via MCP tool `arc_schedule_self_nudge`. Agent schedules its own 5-min re-entry; on fire, daemon re-prompts with plan-file contents. More robust than wall-clock watchdog because context regenerates from disk.

---

## Phase 10 — Relay (`packages/relay`) + remote access (~2 weeks)

**Deliverable:** self-hosted, E2E-encrypted tunnel. Daemon ↔ client through a zero-knowledge middle.

### Crypto

- Daemon keypair: Curve25519 (`libsodium` box).
- Client keypair: Curve25519.
- Pairing: daemon shows QR containing `{relay_url, daemon_pubkey, pair_code, label}`. Client scans, generates keypair, sends pubkey + pair_code to relay, relay holds it for the daemon to pick up. Daemon verifies pair_code, stores client pubkey in `clients` table.
- Traffic: every WS frame payload encrypted with `crypto_box(shared_secret)`. Relay sees only opaque bytes + routing header.

### Relay server (`packages/relay`)

- Stateless WebSocket multiplexer. Routes by connection pair id.
- No persistence. No logs of payload content.
- Docker image: `ghcr.io/axiom-labs/arc-relay:<ver>`.
- Ships with `docker-compose.yml` example: relay + nginx + certbot.

### CLI on daemon side

```bash
arc daemon relay enable --url wss://my-relay.example.com
arc daemon relay disable
arc daemon relay status
arc daemon pair --label "my phone"    # prints QR
arc daemon clients                    # list paired clients
arc daemon revoke <client-id>
```

### CLI on client side

```bash
arc --host 192.168.1.50:7272 ls       # LAN, no relay
arc --relay <pair-code> ls            # via relay
```

### Security (documented in `SECURITY.md`)

- Threat model: relay compromise, MITM, replay, DNS rebinding, pair-code leak.
- Mitigations: NaCl box + session nonces, argon2 on tokens, host-header validation, CORS allowlist, 5-min pair-code TTL, per-client revocable tokens.

---

## Phase 11 — Electron wrapper (`packages/desktop`) (~1 week)

**Deliverable:** `.dmg`, `.exe`, `.AppImage`. Auto-starts daemon on launch; dashboard UI served inside.

- Thin Electron shell. No business logic; just spawns `arc daemon start` + loads `http://127.0.0.1:7272`.
- Native touches: dock badge on agent completion, tray icon, file-dialog bridge for picking repos, native menu.
- Auto-updates via existing `src/update.ts` (npm-based) or GitHub releases.
- CI workflow: build on all three OSes, publish to releases.

---

## Phase 12 — Mobile app (`packages/mobile`, Expo) (~3–4 weeks)

**Deliverable:** iOS + Android app. Scans pairing QR, talks to daemon via relay.

- Expo app. React Native.
- Reuses `@axiom-labs/arc-client` (RN-compatible build).
- Screens: Agents list, Agent detail (live terminal + events), Chat rooms, New agent, Settings.
- Features: voice dictation (Expo Speech), push notifications on agent completion / stall, QR scanner for pairing.
- Deploy: TestFlight + Play Store internal track first. Public release gated on relay stability.

---

## Phase 13 — Docker "server" mode (~3 days)

**Deliverable:** official `ghcr.io/axiom-labs/arc-daemon` image for headless hosts.

- Runs daemon headless in container. Mount `~/.arc`, expose 7272.
- No TUI; no Electron. Pure daemon.
- Use case: dev workstation, home server, shared team box.
- Compose example: daemon + relay + watchtower.

```yaml
services:
  arc-daemon:
    image: ghcr.io/axiom-labs/arc-daemon:1
    ports: ["7272:7272"]
    volumes: ["./arc-data:/home/arc/.arc"]
    restart: unless-stopped
```

---

## Phase 14 — Polish, notifications, migration (~1 week)

- **Push notifications:** per-client `notifyOnFinish` flag; daemon emits on agent complete/stall/fail.
- **No-poll discipline:** bake into skills, docs, client SDK — subscriptions only.
- **Timeline compaction:** after N epochs or M events, rewrite snapshot row; prune events older than archive window.
- **Migration script:** `arc migrate v2-to-v3` — ingests `~/.arc/history.json`, per-profile session JSON, `activity.log` into SQLite.
- **Deprecate TUI-as-host code paths** — confirm no direct adapter spawn remains outside the daemon.

---

## Timeline estimate

| Phase | Effort | Cumulative |
|---|---|---|
| 0 Prep | 1 day | 1 day |
| 1 Daemon | 1 wk | ~1.5 wk |
| 2 Protocol | 4 d | ~2.5 wk |
| 3 Client SDK | 3 d | ~3 wk |
| 4 Port surfaces | 2 wk | ~5 wk |
| 5 Provider `extends` | 2 d | ~5.5 wk |
| 6 `arc loop` | 1 wk | ~6.5 wk |
| 7 Chat rooms | 1 wk | ~7.5 wk |
| 8 Worktrees | 3 d | ~8 wk |
| 9 Roundtable/handoff | 4 d | ~8.5 wk |
| 10 Relay | 2 wk | ~10.5 wk |
| 11 Electron | 1 wk | ~11.5 wk |
| 12 Mobile | 3–4 wk | ~15 wk |
| 13 Docker | 3 d | ~15.5 wk |
| 14 Polish | 1 wk | ~16.5 wk |

**~4 months solo, linear.** Phases 1→4 are the critical path; 5–9 can be interleaved with 10–14 once the protocol is stable.

---

## Open questions (to answer before each phase kicks off)

- **Phase 1:** any existing `packages/dashboard/src/server.ts` logic worth extracting wholesale vs rewrite clean in `packages/daemon`? Probably extract the WS accept path, rewrite the rest.
- **Phase 2:** do we want protobuf for frames instead of length-prefixed JSON? Not yet — start with JSON, keep the option open since frame header is opaque to content.
- **Phase 4:** TUI rewrite scope — do we keep all 13 views or simplify on the way?
- **Phase 6:** should loops be resumable across daemon restarts? Yes if the worker is a tool with persistent session (claude); no if the CLI doesn't support it. Adapter-specific flag.
- **Phase 10:** relay TLS — do we require it (refuse `ws://`) or allow self-signed for LAN? Require `wss://` on relay, allow `ws://` only on 127.0.0.1.
- **Phase 12:** voice mode parity with Paseo — nice-to-have or MVP? Defer to a later release.

---

## Cross-cutting conventions

- **Every new control message type starts with Zod schema + test.** Schema lives in `packages/client/src/protocol.ts` so daemon and client share it.
- **Never remove a field.** Deprecate (stop sending, keep accepting). Only major version bump removes.
- **No polling in clients.** Subscriptions only. If a feature seems to need polling, the daemon is missing an event — add the event.
- **All long-running work emits status events.** "silent work" is a bug.
- **SQLite migrations are additive until 2.0.** Never drop a column in a minor.

---

## Out of scope for v3

- Hosted relay at `relay.arc.sh` — self-host only.
- Cloud-sync of profiles or sessions — purely local.
- Non-WebSocket transports (gRPC, HTTP/2, SSE fallback).
- Browser extension integrations.
- AI model fine-tuning / RAG on ARC's own logs.

These go into `docs/expansion-ideas.md` if they come up.

---

## Acceptance criteria for v3 (1.0.0) shipping

1. `arc daemon start` runs headless on Mac, Windows, Linux; Electron app boots it.
2. TUI, dashboard, and CLI are all clients. Zero direct adapter calls outside daemon.
3. `arc run claude "hello"`, `arc ls`, `arc attach <id>`, `arc stop <id>` work end-to-end.
4. `arc loop` completes a full worker/verifier cycle with cross-provider verify.
5. Chat rooms: two agents post/read/mention each other.
6. Mobile app (TestFlight + Play internal): can attach to a remote daemon via relay and stream terminal output.
7. Docker image boots a headless daemon reachable from the mobile app.
8. `arc migrate v2-to-v3` ingests a real v0.4.0 `~/.arc/` without loss.
9. v3 docs site updated; `paseo.sh`-equivalent page published.
10. Security audit of relay (self): threat model documented, all items mitigated or accepted.
