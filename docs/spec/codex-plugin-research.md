---
title: ARC Research — Codex Plugin for Claude Code
type: reference
parent: "[[ARC]]"
updated: 2026-04-01
tags:
  - arc
  - research
  - codex
  - claude-code
  - agent-orchestration
---

# ARC Research — `openai/codex-plugin-cc` Architecture Analysis

Source: [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) (Official OpenAI, v1.0.2, 8.5k stars)

**Action items:** Fork with upstream tracking. Study patterns below for ARC Phase 2+ implementation. Consider "popular add-ons" feature in ARC that surfaces community plugins like this.

---

## 10 Extractable Patterns for ARC

### 1. Layered Delegation Model
Command → Subagent → Runtime Script, with explicit capability restrictions at each layer. The rescue subagent is intentionally "thin" — it can only forward tasks to Codex, never reason independently or call other commands. Each layer has an `allowed-tools` whitelist.

**ARC application:** Adapter capability scoping. When ARC delegates to a child agent, define explicit tool/action boundaries per delegation layer.

### 2. Broker/Pool Pattern
`CodexAppServerClient` supports two transport modes:
- **Direct:** Spawns `codex app-server` as child process, stdin/stdout JSONL
- **Broker:** Persistent background process on Unix domain socket, multiplexes requests with ownership tracking

When broker is busy → returns `BROKER_BUSY_RPC_CODE (-32001)` → client falls back to direct spawn. Allows `turn/interrupt` from different sockets even during active streams.

**ARC application:** Agent process pooling for the orchestration layer. One persistent runtime shared across concurrent requests, automatic fallback to direct launch.

### 3. Supervisor Gate (Stop Hook)
When enabled, a `Stop` hook fires whenever Claude tries to end its response:
1. Reads hook input (last_assistant_message, session_id, cwd)
2. Spawns synchronous Codex task (15 min timeout)
3. Codex reviews Claude's output
4. First line must be `ALLOW: <reason>` or `BLOCK: <reason>`
5. BLOCK → Claude must continue working

**Key design:** Gate only fires for substantive code changes, not status/reporting turns. Checks for second-order failures, empty-state behavior, retries, stale state, rollback risk.

**ARC application:** Direct implementation target for supervision hooks. The ALLOW/BLOCK protocol with structured first-line parsing is simple and reliable. The "only gate substantive work" filter prevents supervision overhead on trivial turns.

### 4. Semantic Progress Phases
Typed phase values for observability:
- `starting` → `reviewing` | `running` | `verifying` | `editing` | `investigating` → `finalizing` → `done`
- Also: `queued`, `failed`

Verification detection via regex matching common test/lint/build commands. Item-level progress translates app-server notifications into human-readable messages.

**ARC application:** Standard phase vocabulary for the observability layer. Map all adapter events to these semantic phases for unified dashboard/trace rendering.

### 5. Background Job System
- Per-workspace state: `$CLAUDE_PLUGIN_DATA/state/<slug>-<sha256hash>/state.json`
- Jobs stored as separate JSON files, max 50 per workspace, pruned by update time
- Job IDs: `<prefix>-<base36-timestamp>-<random>`
- Detached child processes with PID tracking for cancellation
- Session-scoped cleanup on exit (broker shutdown, orphan kill, state prune)

**ARC application:** Blueprint for background agent task management. The job file protocol with separate payload files is cleaner than embedding everything in a single state file.

### 6. Turn State Machine (Multi-Agent)
`TurnCaptureState` manages complex lifecycle with subagents:
- Tracks thread IDs, turn IDs, labels, pending collaborations, active subagent turns
- **Inferred completion:** `finalAnswerSeen` + no pending collaborations + no active subagent turns → 250ms timer → auto-complete
- Notification routing filters by known threads + matching turn IDs

**ARC application:** Core pattern for Roundtable and multi-agent orchestration. The inferred completion with timeout-based draining is exactly what's needed for hierarchical agent coordination.

### 7. Thread Persistence & Resume
- Named threads: `"Codex Companion Task: <excerpt>"`
- `thread/list` filtered by prefix, `thread/resume` vs `thread/start`
- Heuristic detection of follow-up instructions ("continue", "keep going", "resume")
- User choice: "Continue current thread?" vs "Start new thread"

**ARC application:** Session continuity for long-running agent tasks. Named thread convention enables cross-session task resumption.

### 8. Structured Review Schema
```json
{
  "verdict": "approve" | "needs-attention",
  "summary": "string",
  "findings": [{ severity, title, body, file, line_start, line_end, confidence, recommendation }],
  "next_steps": ["string"]
}
```

Adversarial prompt design: "Default to skepticism", prioritized attack surface, "prefer one strong finding over several weak ones."

**ARC application:** Standard review output format for any code review hook. The confidence + severity fields enable threshold-based auto-gating.

### 9. Skill-as-Contract
Three internal skills define behavioral boundaries:
- `codex-cli-runtime` — How to invoke the companion script
- `codex-result-handling` — How to present output (critical: NEVER auto-apply review fixes)
- `gpt-5-4-prompting` — Prompt engineering with XML-tagged block taxonomy (`<task>`, `<structured_output_contract>`, `<verification_loop>`, `<action_safety>`)

**ARC application:** Skills should define what an agent CAN'T do, not just what it can. The prompt block taxonomy is a good starting point for standardizing inter-agent communication.

### 10. Session Lifecycle Hooks
- **SessionStart:** Injects `CODEX_COMPANION_SESSION_ID` and `CLAUDE_PLUGIN_DATA` into Claude's env via `CLAUDE_ENV_FILE`
- **SessionEnd:** Sends broker shutdown, kills orphaned jobs, cleans up state files
- Hook types: `SessionStart`, `SessionEnd`, `Stop`

**ARC application:** Direct mapping to ARC's hook pipeline. The env injection pattern is how adapters should communicate session identity to child processes.

---

## Proposed ARC Feature: Popular Add-Ons

Surface community/official plugins as installable add-ons through ARC. Instead of users manually discovering repos like this, ARC could:
- Maintain a curated registry of agent plugins (Codex plugin, review tools, etc.)
- `arc plugin install codex-cc` → fork with upstream tracking, auto-configure
- `arc plugin update` → pull upstream changes
- Profile-scoped plugin activation (some projects get Codex review, others don't)

This positions ARC as not just a control plane but a **distribution channel** for agent tooling.

---

## Related
- [[ARC]] — Parent project
- [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) — Source repo
- [[ClawPort Reference]] — Complementary operator console
