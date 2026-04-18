# Plan: AI Chat + Full Roundtable Integration

**Status:** Approved — revised 2026-04-18, starting Phase 0.5 + Phase 1
**Last updated:** 2026-04-18
**Owner:** Bailey

## Decisions (approved 2026-04-18)

1. **Permission default:** `supervised` — writes require confirmation, dangerous tools allowed with explicit confirm.
2. **Backend approach (revised):** **CLI-spawn, not HTTP.** The dashboard AI and roundtable orchestrator spawn the profile's actual CLI tool (`claude`, `codex`, `gemini`) as a child process — same pattern as Agent-Forge. Prompts are delivered via configured input method (sendKeys / pasteFromFile / direct arg); responses captured via stdout. Tool use flows through MCP injected at launch (the three `mcpMode` variants). **No direct HTTP LLM client is built** — we orchestrate the existing agents' own tool use.
3. **License:** Agent-Forge is Bailey's project; copy freely with attribution comments.
4. **Session storage:** per profile — `~/.arc/profiles/<name>/chat-sessions/`.
5. **Roundtable composition:** support **both** real-profile agents (each agent = its own ARC profile) and virtual agents (N role-differentiated agents all using the same profile).
6. **Dangerous tool scope:** allowed in dashboard AI with explicit confirm modal; always logged to activity.log regardless of mode.

---

## Goal

Ship three interlocking capabilities that let end users fully leverage ARC:

1. **Dashboard AI chat** — a chat panel in the web dashboard that uses the user's chosen ARC profile's provider, has deep knowledge of ARC's features/state/config, and can **act** on ARC (create/clone profiles, configure providers, import/export, run doctor, start roundtables, etc.) via a tool-use layer.
2. **Full roundtable feature** — promote the existing `roundtable` hook from a state-tracking hook into a first-class feature with CLI (`arc roundtable`), MCP tool, and dashboard UI. Preserve the hook's state machine; add the missing orchestrator loop.
3. **Multi-agent pipelines from the dashboard** — UI to configure and run multi-agent flows (roundtable, PLAN→EXEC→VERIFY, consensus gates) with live progress, transcript, and outcome.

Surfaces required for all three: **CLI + MCP + Dashboard**.

---

## Ground Truth (from recon)

### What ARC has today

| Surface | Status |
|---|---|
| Roundtable hook (`packages/core/src/hooks/roundtable.ts`, 580 lines, priority 50) | Production-quality turn/state/mode machinery. Zero test coverage. No driver loop. |
| Interagent routing (bypass during active roundtable) | Working, tested. |
| Adapters (Claude/Gemini/Codex/OpenClaw/Hermes/openai-compat) | Process-spawn only. **No direct LLM calls anywhere.** |
| `ProviderConfig` on Profile (baseUrl, model, apiKeyEnvVar, displayName) | Stored, never used for HTTP calls. |
| `LLMCompleteFn` placeholder type in `completion-auditor.ts:42` | Intentional stub for "future M004 milestone". |
| MCP server (`@axiom-labs/arc-mcp`) | 5 tools: classify_risk, audit_completion, expand_intent, derive_completion, explain_trace. Clean authoring pattern. Stdio + HTTP transport. |
| Dashboard (`packages/dashboard/`) | Raw `node:http` + hand-rolled RFC6455 WS. Vanilla JS SPA. `ws.broadcast()` is all-clients only. Clean route registration pattern. |
| Dark Factory Mode | State machine (idle→planning→executing→verifying→gating→completed) exists but is disconnected from roundtable. |

### What Agent-Forge has (at `C:\Users\Bailey\Desktop\Open-Projects\agent-forge`)

| Component | Port decision |
|---|---|
| `AgentDeliveryPolicy` + `computeAdaptiveGraceMs` + `updateReplyLatencyAverage` (`lib/agent-delivery.ts`) — model-aware adaptive pacing with EMA latency tracking | **Port verbatim** — zero deps, pure functions, directly useful |
| `StagedWorkflowManager` (`lib/staged-workflow.ts`) — PLAN→EXEC→VERIFY state machine with cursor-based message polling | **Port** as generic pipeline primitive |
| `AgentWatchdog` (`lib/agent-watchdog.ts`) — stall detection, nudge at 3min, mark stalled at 5min, decision messages | **Port** adapted to ARC's process model |
| 6-tool MCP contract: `team_say` / `team_read` / `team_status` / `team_done` / `team_plan` / `team_ask` | **Port contract**, reimplement on `@modelcontextprotocol/sdk` |
| `agents.json` + `mcpMode` variants (`config-file` / `mcp-add` / `config-args`) | **Absorb as tribal knowledge** into ARC adapter layer |
| `collab-templates.json` (4 role templates) | **Reimplement** as ARC roundtable templates |
| REST server, React dashboard, RBAC, tmux runtime | **Skip** — wrong fit |

### Critical Gap

**Neither ARC nor Agent-Forge has a direct LLM client.** Every feature the user wants (chat, headless roundtable, consensus pipelines) requires building one. That is the blocker for all phases.

---

## Architectural Decisions

### AD-1: CLI-spawn agent client (revised)

**Decision:** do not build a direct HTTP LLM client. Instead, build an `AgentClient` abstraction that spawns the profile's CLI tool (`claude`, `codex`, `gemini`) with an input prompt and captures its response — the Agent-Forge pattern.

Why:
- ARC's whole investment is in CLI adapters; reuse it.
- The agent tools already have their own streaming, tool use, and MCP integration — we orchestrate, not reimplement.
- MCP is the clean interop surface: inject ARC's tool server at spawn time, every agent (Claude / Codex / Gemini) can call ARC tools through the same contract.
- No per-provider auth reinvention. OAuth/API keys are already resolved by the native CLI.

New module: `packages/core/src/agent-client/`.

```typescript
interface AgentClient {
  // One-shot: send a prompt, stream response until the agent signals done
  send(prompt: string, opts?: {
    mcpConfig?: McpConfigInjection;
    instructions?: string;
    signal?: AbortSignal;
  }): AsyncIterable<AgentChunk>;
  shutdown(): Promise<void>;
}

type AgentChunk =
  | { type: "text"; content: string }
  | { type: "tool_call"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; result: unknown }
  | { type: "done"; reason: "end_turn" | "max_turns" | "stop" };
```

Three implementations, one per tool, each derived from Agent-Forge's `agents.json` entries:
- **`ClaudeAgentClient`** — `claude` binary, `--mcp-config <file>` injection, stdout parser
- **`CodexAgentClient`** — `codex` binary, `-c mcp.servers.arc={json}` injection
- **`GeminiAgentClient`** — `gemini` binary, `gemini mcp add` pre-launch

Dispatcher: `getAgentClientForProfile(profile): AgentClient` — picks by `profile.tool`.

Input delivery methods ported from Agent-Forge (`inputMethod` field):
- `sendKeys` — line-by-line stdin write
- `pasteFromFile` — write prompt to temp file, send `/paste <file>` command
- `direct` — pass as CLI arg (one-shot non-TUI mode)

For the first cut, use each tool's **one-shot non-TUI mode** where possible (`claude -p "<prompt>"`, `gemini -p "<prompt>"`, `codex exec --json`). This sidesteps TUI capture complexity. Upgrade to persistent TTY sessions in a later phase if needed for multi-turn roundtables.

### AD-2: Tool Registry + agent loop

Separate from the LLM client:

```typescript
interface Tool {
  name: string;
  description: string;
  schema: z.ZodSchema;
  permission: "read" | "write" | "dangerous";
  handler: (input: unknown, ctx: ToolContext) => Promise<unknown>;
}

class ToolRegistry {
  register(tool: Tool): void;
  getSchemas(filter?: (t: Tool) => boolean): ToolDefinition[];
  async execute(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult>;
}
```

Agent loop (`runAgent(client, registry, prompt, mode)`):
1. Send prompt + tool schemas to client
2. For each chunk: if text → emit; if tool_use → execute via registry, gate by permission mode, append tool_result to conversation, loop
3. Stop on end_turn

Three permission modes:
- `read-only` — only `read` tools available
- `supervised` (default) — `write` tools require user confirmation via UI; `dangerous` tools always blocked
- `autonomous` — all tools available, all writes logged to `activity.log`

### AD-3: ARC tool set

Core tools (all map to existing CLI handlers or core functions):

**Read:** `list_profiles`, `show_profile`, `get_active_profile`, `list_launches`, `query_logs`, `doctor_report`, `list_mcp_servers`, `list_skills`, `list_memories`, `list_tasks`, `list_remote_agents`, `get_arc_feature` (returns info about any ARC feature from a bundled knowledge index)

**Write:** `create_profile`, `clone_profile`, `switch_active_profile`, `set_profile_flags`, `set_instructions`, `configure_provider`, `backup_create`, `profile_export`, `profile_import`, `mcp_connect`, `delegate_task`

**Dangerous:** `delete_profile`, `backup_restore`, `prune`, `mcp_tool_call` (calling arbitrary MCP tools)

**Meta:** `start_roundtable`, `run_pipeline` (PLAN→EXEC→VERIFY)

### AD-4: Roundtable as hook + orchestrator

Keep the existing hook. Add `RoundtableOrchestrator` that:

1. Accepts `{ topic, agents: { profile, role }[], rounds, synthesizer }`
2. Initializes state via existing hook (triggering with `@roundtable` prefix)
3. Loops: read current turn from `RoundtableState`, get that profile's `LlmClient`, call with built prompt (role + transcript so far), post response back into `HookBus.runPost()` to advance state
4. On state transition to `"synthesizing"`: call designated synthesizer with structured prompt requesting consensus score + summary
5. Returns `{ transcript, synthesis, consensus: 0-1, durationMs }`

Uses Agent-Forge's `AgentDeliveryPolicy` for between-turn pacing.

### AD-5: Dashboard per-session streaming

Extend WS server:
- Add `sessionId` negotiation on connect (client sends `{ type: "hello", sessionId: "uuid" }`)
- `ws.broadcastTo(sessionId, event, data)` method
- `ws.broadcast()` preserved (no sessionId filter = all clients)

Chat streaming uses `broadcastTo` — text chunks stream to only the originating session. Roundtable runner uses `broadcast` — all viewers see live progress.

### AD-6: Knowledge endowment

Build-time + runtime system prompt composition:

**Static** (baked at build):
- ARC purpose + architecture summary (~300 words)
- Command reference (extracted from `cli.ts` via codegen, ~50 commands × one-line desc)
- Tool catalog (auto-generated from `ToolRegistry`)
- Links to doc pages (for the AI to cite)

**Runtime** (per chat session):
- Active profile + provider + model
- Profile count, last 3 launches, any failing doctor checks
- Current ARC version
- Warning if shared layer has unresolved conflicts

No embeddings, no vector DB. Scope is bounded enough that a well-curated prompt beats retrieval.

### AD-7: License + porting hygiene

- Check `agent-forge/LICENSE` before copying any code. If MIT/Apache-compatible: copy with attribution comment pointing to upstream file path. If GPL or proprietary: reimplement from the design, not the code.
- Put ported code in clearly-named files (`packages/core/src/orchestration/delivery-policy.ts`) with a top-of-file comment: `// Ported from agent-forge/lib/agent-delivery.ts — see docs/plans/ai-and-roundtable.md AD-7`.

---

## Phased Delivery

### Phase 0 — Scaffolding
**Deliverables:**
- Create `packages/core/src/agent-client/` + `packages/core/src/orchestration/` + `packages/core/src/knowledge/` with placeholder index files
- Port `agents.json` → `packages/core/src/agent-client/registry.ts` as a typed constant (Claude, Codex, Gemini entries with `command`, `flags`, `readyMarker`, `inputMethod`, `mcpMode`, `promptDelivery`)
- Stub `AgentClient` interface in `types.ts`

**Exit criteria:** directory structure + types in place, clean build

---

### Phase 0.5 — Launch hygiene (native vs orchestrated)

**Context:** Currently adapters use `spawnManagedProcess()` which captures stdout for monitoring — this puts tools in "worker mode" and prevents their native TUI chrome (e.g., Claude's statusLine) from rendering. Users need the option to launch a tool in its full native experience.

**Deliverables:**
- [ ] Add `launchMode?: "native" | "worker"` to `Profile` type (default `"native"`)
- [ ] `native` mode: use `spawnSync` with inherited stdio (full TTY handoff, ARC TUI exits) — same as the existing fallback path in `launch.ts:511-526`
- [ ] `worker` mode: keep existing `spawnManagedProcess` path (for roundtable, team sessions, programmatic orchestration)
- [ ] `arc launch <profile> --native` / `--worker` CLI flags override profile setting
- [ ] Doctor check: detect deprecated `CLAUDE_CODE_NO_FLICKER=1` in env, warn + hint "v2.1.110+ uses `/tui fullscreen` — unset this var"
- [ ] ProfilesView: show launch mode in detail pane; `m` key toggles native/worker
- [ ] Update docs (`user-docs/profiles.md`) with the two modes

**Acceptance:**
- `arc launch claude-profile` (native default) → Claude paints its own TUI with statusLine
- `arc launch claude-profile --worker` → Claude runs under ARC supervision for orchestration
- Roundtable orchestrator (Phase 5) forces worker mode regardless of profile setting
- Doctor flags stale `CLAUDE_CODE_NO_FLICKER`

**Non-blocking:** can ship independently of the rest of the plan.

---

### Phase 1 — Agent client (CLI-spawn) foundation
**Deliverables:**
- [ ] `packages/core/src/agent-client/types.ts` — `AgentClient`, `AgentChunk`, `McpConfigInjection`, `InputMethod`
- [ ] `packages/core/src/agent-client/claude.ts` — one-shot mode: `claude -p "<prompt>" --output-format stream-json --mcp-config <file>`; line-parse `stream-json` output into `AgentChunk`
- [ ] `packages/core/src/agent-client/codex.ts` — one-shot mode: `codex exec --json` with prompt on stdin; parse JSON event stream
- [ ] `packages/core/src/agent-client/gemini.ts` — one-shot mode: `gemini -p "<prompt>"`; plain text capture (no structured tool events — tool use surfaced via MCP server side-channel)
- [ ] `packages/core/src/agent-client/dispatch.ts` — `getAgentClientForProfile(profile): AgentClient`
- [ ] `packages/core/src/agent-client/mcp-injection.ts` — writes temp MCP config per `mcpMode` variant
- [ ] Unit tests: mock child process, verify prompt delivery + chunk parsing for each client
- [ ] Export from `packages/core/src/index.ts`

**Acceptance:**
- With a Claude profile + API key or OAuth, `agentClient.send("list 3 facts about TypeScript")` yields text chunks and a `{type:"done"}` terminator
- Same for Codex and Gemini profiles
- MCP config injection writes to the right location per agent (validated by inspecting the temp file)
- Typecheck + build + tests clean

**Blocks:** Phases 2, 4, 5, 6, 7, 8

---

### Phase 2 — Tool registry + agent loop
**Deliverables:**
- [ ] `packages/core/src/agent/tools.ts` — `Tool`, `ToolRegistry`, `ToolContext`
- [ ] `packages/core/src/agent/loop.ts` — `runAgent(client, registry, ctx)` generator
- [ ] `packages/core/src/agent/arc-tools.ts` — ARC tool definitions (list_profiles, clone_profile, etc.) wired to existing handlers
- [ ] Permission gating: `read-only` / `supervised` / `autonomous` modes with confirmation callback
- [ ] Unit tests for loop: mock client emitting tool_use, verify registry dispatch + result injection

**Acceptance:**
- Agent loop can answer "what profiles do I have?" using `list_profiles` tool
- Supervised mode blocks `clone_profile` until confirm callback returns true
- 20+ ARC tools wired and callable

---

### Phase 3 — Knowledge endowment
**Deliverables:**
- [ ] `packages/core/src/knowledge/index.ts` — static knowledge object (ARC purpose, architecture, command ref, doc links)
- [ ] `scripts/build-command-ref.js` — codegen script reading `cli.ts` to extract commands into a TS constant (run in `prebuild`)
- [ ] `packages/core/src/knowledge/runtime.ts` — `buildSystemPrompt(ctx)` composing static + live state snapshot
- [ ] `packages/core/src/knowledge/feature-index.ts` — structured feature catalog from FEATURES.md + `get_arc_feature` tool implementation

**Acceptance:**
- System prompt is deterministic, reproducible, under 4000 tokens
- Live snapshot section reflects current config within 10s of change

---

### Phase 4 — CLI surface: `arc chat`
**Deliverables:**
- [ ] `packages/cli/src/commands/chat.ts` — interactive terminal chat using `readline`, streams to stdout
- [ ] Flags: `--profile <name>` (override active), `--mode read-only|supervised|autonomous`, `--once <prompt>` (one-shot), `--no-tools`
- [ ] CLI registration in `cli.ts`
- [ ] Integration test: one-shot mode with a fake LLM client

**Acceptance:**
- `arc chat` opens REPL using active profile's LLM client
- `arc chat --once "list my profiles"` returns tool-call-driven answer and exits
- Supervised mode shows confirmation prompts in terminal

---

### Phase 5 — Roundtable orchestrator
**Deliverables:**
- [ ] `packages/core/src/orchestration/delivery-policy.ts` — port `AgentDeliveryPolicy` + `computeAdaptiveGraceMs` + EMA latency
- [ ] `packages/core/src/orchestration/staged-workflow.ts` — port `StagedWorkflowManager` (PLAN/EXEC/VERIFY)
- [ ] `packages/core/src/orchestration/roundtable.ts` — `RoundtableOrchestrator` driving the existing hook
- [ ] Watchdog port: `packages/core/src/orchestration/watchdog.ts`
- [ ] Tests: roundtable with 3 mocked agents, state progression, synthesis, consensus score
- [ ] First tests for the roundtable hook itself (fill the coverage gap)

**Acceptance:**
- `RoundtableOrchestrator.run({ topic, agents, rounds: 2 })` produces a full transcript + synthesis with consensus float
- Adaptive pacing reduces throttling for fast providers
- Roundtable hook now has ≥ 80% line coverage

---

### Phase 6 — `arc roundtable` CLI + MCP tools
**Deliverables:**
- [ ] `packages/cli/src/commands/roundtable.ts` — `arc roundtable <topic> --agents <p1,p2,p3> --rounds 2`
- [ ] Streaming transcript to terminal with per-agent color coding
- [ ] `packages/mcp/src/tools/roundtable.ts` — `arc_roundtable` MCP tool
- [ ] `packages/mcp/src/tools/chat.ts` — `arc_chat` MCP tool (one-shot, no streaming)
- [ ] `packages/mcp/src/tools/team/` — port 6-tool contract (`team_say`, `team_read`, etc.) for inter-agent comms in team sessions

**Acceptance:**
- `arc roundtable "should we rewrite X?" --agents fast-opus,claude-sonnet,codex` produces usable transcript
- MCP inspector shows new tools; invoking them works end-to-end
- Existing 5 MCP tools still pass integration tests

---

### Phase 7 — Dashboard chat view
**Deliverables:**
- [ ] `packages/dashboard/src/ws.ts` — add `sessionId` negotiation + `broadcastTo(sessionId, event, data)`
- [ ] `packages/dashboard/src/api.ts` — new `POST /api/chat/message` endpoint; emits chunks via `broadcastTo`
- [ ] `packages/dashboard/public/components/chat.js` — chat view with message list, streaming incoming chunks, tool-call visualization
- [ ] Sidebar: add "Chat" item
- [ ] Settings panel: permission mode toggle (`read-only` / `supervised` / `autonomous`)
- [ ] Confirmation modal for supervised writes

**Acceptance:**
- End user opens dashboard, picks a profile, chats about ARC
- Tool calls render as expandable panels showing input + result
- Clone/export/backup actions work through chat with confirmations
- Session history persists across page reload (stored in `~/.arc/chat-sessions.json`)

---

### Phase 8 — Dashboard roundtable + pipelines view
**Deliverables:**
- [ ] `packages/dashboard/public/components/roundtable.js` — configure roundtable (topic, agents from profile picker, rounds), start, watch live transcript, see synthesis
- [ ] `packages/dashboard/public/components/pipelines.js` — configure staged workflow (PLAN→EXEC→VERIFY), watch phase progression, see phase messages
- [ ] `POST /api/roundtable/run` + `POST /api/pipeline/run` endpoints with WS broadcast updates
- [ ] Persist past runs to `~/.arc/roundtables/<id>.json` and `~/.arc/pipelines/<id>.json` with a history list

**Acceptance:**
- User configures + runs a 2-round roundtable from dashboard
- Live updates via WS, no polling
- History view shows past runs with result summary

---

### Phase 9 — Docs + polish
**Deliverables:**
- [ ] `user-docs/` page: "AI Chat Guide" (what it can do, permission modes, safety)
- [ ] `user-docs/` page: "Running Roundtables" (CLI + dashboard examples)
- [ ] `user-docs/` page: "Multi-Agent Pipelines" (PLAN/EXEC/VERIFY pattern)
- [ ] FEATURES.md updates: mark new items shipped
- [ ] DEVLOG.md entry summarizing design choices
- [ ] Version bump: 0.3.0 → 0.4.0 (minor, new features)

**Acceptance:**
- Docs buildable, linked from nav
- Version bump consistent across CLI + site

---

## Open Questions — all answered 2026-04-18

See **Decisions** section at the top of this doc.

---

## Out of Scope (explicitly)

- Embedding/vector store for doc retrieval — bounded domain, skip.
- Fine-tuning or custom models — providers handle this upstream.
- Voice chat or image input — text only for v1.
- Dashboard authentication beyond the existing token — chat inherits the dashboard's auth model, no new identity layer.
- Multi-user chat or shared sessions — single-user context.
- Running roundtables across machines — localhost only for v1. Remote agents (Phase 24) already handle cross-machine agent registry but orchestration stays local.

---

## Progress Tracking

Update checkboxes in-place as phases complete. Add a `Completed YYYY-MM-DD` marker at the bottom of each phase.

### Phase 0 — Scaffolding
- [x] **Completed 2026-04-18** — folded into Phase 1 commit `6ff876b`

### Phase 0.5 — Launch hygiene (native vs orchestrated)
- [x] **Completed 2026-04-18** — commit `6ff876b`. `launchMode` field, `--native`/`--worker` flags, doctor check, `m` toggle in ProfilesView, docs section in user-docs/guide/profiles.md

### Phase 1 — Agent client (CLI-spawn) foundation
- [x] **Completed 2026-04-18** — commit `6ff876b`. `packages/core/src/agent-client/` with Claude/Codex/Gemini clients, MCP injection per mcpMode variant, stream parsers, 48 unit tests. Unverified CLI flags flagged for Phase 4 smoke test.

### Phase 2 — Tool registry + agent loop
- [ ] Not started

### Phase 3 — Knowledge endowment
- [ ] Not started

### Phase 4 — CLI `arc chat`
- [ ] Not started

### Phase 5 — Roundtable orchestrator
- [ ] Not started

### Phase 6 — `arc roundtable` CLI + MCP tools
- [ ] Not started

### Phase 7 — Dashboard chat view
- [ ] Not started

### Phase 8 — Dashboard roundtable + pipelines
- [ ] Not started

### Phase 9 — Docs + polish
- [ ] Not started

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Agent-Forge license incompatibility | Low | Medium | Check before Phase 5; reimplement from design if needed |
| Streaming SSE parsing bugs across providers | Medium | Medium | Test matrix against 3 providers (OpenRouter, Ollama, LM Studio) before Phase 7 |
| Tool schemas grow unwieldy | Medium | Low | Auto-generate from existing zod schemas on CLI commands where possible |
| Dashboard WS broadcast refactor breaks existing views | Low | High | Preserve `broadcast()` as alias for broadcast-to-all; add `broadcastTo()` alongside |
| Chat context window blown by tool results | Medium | Medium | Truncate large tool results (default 4KB); summarize after N turns using context-manager (Phase 19 infra already exists) |
| Roundtable LLM costs balloon | Medium | Low | Default to 2 rounds, surface cost estimate before run, allow `--dry-run` |
| Users abuse autonomous mode, lose data | Low | High | Ship supervised as default; `arc config` flag required to enable autonomous; prominent disclaimer |

---

## References

- Recon: `C:\Users\Bailey\Desktop\Open-Projects\agent-forge\` (see Ground Truth section)
- Roundtable hook: `packages/core/src/hooks/roundtable.ts`
- Interagent routing: `packages/core/src/hooks/interagent-routing.ts`
- Hook bus: `packages/core/src/hooks/create-default-bus.ts`
- Profile types: `packages/core/src/types.ts:35-59`
- Dashboard server: `packages/dashboard/src/server.ts`
- Dashboard WS: `packages/dashboard/src/ws.ts`
- MCP server: `packages/mcp/src/server.ts`
- MCP tool pattern: `packages/mcp/src/tools/classify-risk.ts`
