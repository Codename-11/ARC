# Multi-agent pipelines

A **pipeline** is a structured state machine over a set of agents. Where a [roundtable](/guide/roundtable) gives every agent the same topic and asks them to discuss, a pipeline moves the whole group through phases in order — `PLAN` → `EXEC` → `VERIFY` — and only advances when each phase's completion criteria are met.

This is the pattern Agent-Forge's staged workflow codified, and 0.4.0 ports it verbatim into `@axiom-labs/arc-core` as `StagedWorkflowManager`.

## Phases

| Phase    | Meaning                                                |
|----------|--------------------------------------------------------|
| `plan`   | Agents describe the approach, share strategy, agree on a plan |
| `exec`   | Agents carry out the plan and report completion        |
| `verify` | Agents (often one dedicated reviewer) confirm the result |

Completion is detected by per-phase **regex patterns** against each agent's messages. The default patterns look for natural-language completion signals:

- `plan`: `/\bplan\b/i`, `/\bstrateg/i`, `/\bapproach\b/i`, `/\bready\b/i`, `/\bplan\s+shared\b/i`
- `exec`: `/\bdone\b/i`, `/\bcomplete(?:d)?\b/i`, `/\bfinished\b/i`, `/\bimplemented\b/i`, `/\bexec_done\b/i`
- `verify`: `/\bverify(?:_ok)?\b/i`, `/\bverified\b/i`, `/\bapproved\b/i`, `/\breview\s+complete\b/i`

You can override the pattern list per phase via `completionPatterns`.

## Timeouts

Each phase has a timeout. If the timeout expires before every agent signals completion, the manager logs the timeout and advances anyway. Defaults:

| Phase  | Default |
|--------|---------|
| plan   | 120 s   |
| exec   | 300 s   |
| verify | 120 s   |

Override per-phase with `phaseTimeoutMs`.

## Programmatic usage

```ts
import {
  StagedWorkflowManager,
  InMemoryMessageBus,
} from "@axiom-labs/arc-core";

const messageBus = new InMemoryMessageBus();
const allAgents = ["planner", "builder", "reviewer"];

const manager = new StagedWorkflowManager(
  {
    phases: ["plan", "exec", "verify"],
    phaseTimeoutMs: { exec: 600_000 },      // 10 min exec
    pollIntervalMs: 100,
    onPhaseChange: (phase) => console.log("→", phase),
  },
  { messageBus, allAgents },
);

const result = await manager.run();
console.log(result.terminal);     // "complete" or "aborted"
console.log(result.transcript);   // StagedMessage[]
```

Post messages from agents into the bus as they produce output:

```ts
messageBus.post({
  id: crypto.randomUUID(),
  from: "planner",
  content: "Plan shared — implement X then run tests.",
  phase: "plan",
  createdAt: Date.now(),
});
```

The manager polls the bus, matches completion patterns, and advances phases automatically.

## Composition with roundtables

Staged workflows and roundtables share the orchestration layer (`packages/core/src/orchestration/`). A common composition:

1. Run a short **roundtable** to pick an approach.
2. Feed the chosen approach into a **staged pipeline** where one agent plans, two agents execute, and a fourth verifies.
3. Use the **watchdog** (`AgentWatchdog`) to nudge any agent that stalls for more than 3 minutes and mark it stalled at 5.

All three modules (`RoundtableOrchestrator`, `StagedWorkflowManager`, `AgentWatchdog`) sit on the same `AgentClient` substrate, so every pipeline participant is simply a profile spawned in worker mode.

## Coming soon: dashboard pipelines view

Phase 8 adds a dashboard view at `/pipelines` where you can:

- Configure a staged workflow (pick agents, tweak phase timeouts, override completion regexes).
- Watch phase progression live over WebSocket.
- See each agent's per-phase messages inline.
- Browse past runs persisted to `~/.arc/pipelines/<id>.json`.

Until that ships, drive the manager from a script.

## See also

- [Roundtables](/guide/roundtable) — unstructured multi-agent discussions.
- [Chat with ARC](/guide/chat) — single-agent REPL.
- [Orchestration](/features/orchestration) — hook pipeline and related primitives.
