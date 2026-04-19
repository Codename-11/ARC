# Running roundtables

A **roundtable** is a multi-agent structured discussion — several profiles take turns offering perspectives on a topic, and a designated synthesizer produces a final summary with a consensus score. Roundtables are the canonical way to get a second (or third, or fourth) opinion before committing to a decision.

## Status

- **Orchestrator:** shipped in 0.4.0. Available programmatically via `@axiom-labs/arc-core`.
- **`arc roundtable` CLI:** *coming soon* — lands in Phase 6 (0.4.x).
- **Dashboard roundtable view:** *coming soon* — lands in Phase 8.
- **MCP tools (`arc_roundtable`, `team_*`):** *coming soon* — lands in Phase 6.

Today you drive a roundtable from code. The CLI and dashboard wrappers are on the roadmap and will land behind this same orchestrator.

## Concepts

### Agents and roles

Each agent is an ARC **profile** paired with a **role** that shapes the prompt the orchestrator sends them:

| Role          | Prompt slant                                       |
|---------------|----------------------------------------------------|
| `advocate`    | Argue for the proposal, surface benefits           |
| `critic`      | Attack weak points, surface risks                  |
| `neutral`     | Weigh trade-offs without a predetermined stance    |
| `synthesizer` | Read the transcript, return consensus + summary    |

You can mix and match — a typical 3-agent setup is one advocate, one critic, one synthesizer.

### Rounds

A roundtable runs for a configurable number of **rounds** (default 2). Each round, every non-synthesizer agent gets one turn to respond to the topic and what's been said so far. The synthesizer runs once at the end.

### Adaptive pacing

Between turns, the orchestrator inserts a model-aware grace period derived from an EMA of the agent's reply latency. Fast providers get shorter gaps; slow providers get more breathing room. This ports the `AgentDeliveryPolicy` + `computeAdaptiveGraceMs` logic from Agent-Forge verbatim.

### Consensus score

The synthesizer is asked to return a JSON blob of the form `{ "consensus": 0.0-1.0, "summary": "..." }`. If it returns prose instead, the orchestrator falls back to `consensus: 0.5` and treats the full text as the summary.

## Worker launch mode

Roundtables require captured stdout streams — the orchestrator parses every chunk. **It therefore forces `launchMode: "worker"` on every participating profile**, regardless of the profile's stored preference or the `--native` flag.

This is intentional. `native` mode hands the TTY to the CLI tool so it can paint its own TUI (statusLine, progress bars, etc.), which means ARC cannot read the output stream. `worker` mode runs the same tool under `spawnManagedProcess`, giving ARC the stdout it needs to drive the state machine.

## Programmatic usage

```ts
import {
  RoundtableOrchestrator,
  loadConfig,
  resolveProfile,
} from "@axiom-labs/arc-core";

const config = loadConfig();
const fastOpus = resolveProfile(config, "fast-opus");
const claudeSonnet = resolveProfile(config, "claude-sonnet");
const codexPro = resolveProfile(config, "codex");

const orchestrator = new RoundtableOrchestrator();

const result = await orchestrator.run({
  topic: "Should we rewrite the hook pipeline in Rust?",
  agents: [
    { profile: fastOpus,     role: "advocate",    displayName: "Rust Advocate" },
    { profile: claudeSonnet, role: "critic",      displayName: "Stability Critic" },
    { profile: codexPro,     role: "synthesizer", displayName: "Summarizer" },
  ],
  rounds: 2,
  onEvent: (evt) => {
    if (evt.type === "turn-complete") {
      console.log(`[${evt.agent}] ${evt.content.slice(0, 80)}...`);
    }
  },
});

console.log("Consensus:", result.consensus);
console.log("Summary:", result.synthesis);
for (const msg of result.transcript) {
  console.log(`r${msg.round} ${msg.role} ${msg.agent}: ${msg.content}`);
}
```

The `onEvent` callback receives `RoundtableEvent` values (`turn-start`, `turn-chunk`, `turn-complete`, `phase-change`, `synthesis-start`, `synthesis-complete`, `error`) so you can stream progress to a UI, log to a file, or abort mid-run via the `signal` option.

## Coming soon: `arc roundtable`

Phase 6 ships a CLI wrapper around the orchestrator:

```bash
# Coming soon in 0.4.x
arc roundtable "should we rewrite X?" \
  --agents fast-opus,claude-sonnet,codex \
  --rounds 2
```

It will stream the transcript to the terminal with per-agent color coding and emit the synthesis + consensus score at the end.

## Coming soon: MCP tools

Phase 6 also exposes the orchestrator over MCP:

- **`arc_chat`** — one-shot chat invocation
- **`arc_roundtable`** — kick off a roundtable and wait for the synthesis
- **`team_say` / `team_read` / `team_status` / `team_done` / `team_plan` / `team_ask`** — 6-tool inter-agent comms contract ported from Agent-Forge

Other agents (running under ARC or elsewhere) will be able to trigger a roundtable as just another MCP tool call.

## See also

- [Chat with ARC](/guide/chat) — single-agent REPL over one profile.
- [Multi-agent pipelines](/guide/multi-agent-pipelines) — PLAN → EXEC → VERIFY state machines using the same orchestration layer.
- [Orchestration](/features/orchestration) — hook pipeline, risk classifier, retry loops.
- [Profiles](/guide/profiles) — how to create the per-role profiles a roundtable consumes.
