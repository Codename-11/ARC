# Hook Pipeline

The hook pipeline is ARC's supervision backbone. Every message and event passes through a sequence of hooks that can inspect, modify, flag, or block operations.

## Enforcement Modes

Hooks run in one of four modes, configurable per-profile:

| Mode | Behavior |
|------|----------|
| `off` | Hook disabled |
| `log` | Hook runs, results logged only (default) |
| `warn` | Hook runs, user notified on flag/block |
| `enforce` | Hook runs, blocks actually prevent execution |

::: tip
ARC defaults to `log` mode. The `enforce` mode must be explicitly opted in. This ensures ARC never unexpectedly blocks your workflow.
:::

## Pipeline Execution

Hooks execute sequentially by priority (lowest number first). Each hook receives a `HookContext` and returns a result:

```typescript
interface Hook {
  name: string;
  priority: number;
  mode: 'off' | 'log' | 'warn' | 'enforce';

  check(ctx: HookContext): Promise<HookResult>;
  inject?(ctx: HookContext): Promise<HookMetadata>;
}

type HookResult = 'pass' | 'flag' | 'block';
```

The pipeline:

1. Sorts hooks by priority
2. Runs each hook's `check()` in sequence
3. Aggregates results — a single `block` stops the pipeline
4. Optionally runs `inject()` for context enrichment
5. Writes a trace entry for every hook evaluation

<ArcFlow diagram="hook-pipeline" height="280px" />

## Built-In Hooks

| Priority | Hook | Description | Status |
|----------|------|-------------|--------|
| 1 | **Source Classifier** | Deterministic message source detection (human/agent/system/cron) | Default pipeline |
| 2 | **Interagent Routing** | Suppress bot-to-bot loops, roundtable-aware | Default pipeline |
| 10 | **Risk Detection** | 5-tier keyword-based risk classification | Default pipeline |
| 20 | **Attempt Tracker** | Session + turn scoped retry counting | Default pipeline |
| 50 | **Roundtable** | [Multi-agent discussion](/features/orchestration#roundtable-discussions) orchestration | Default pipeline |
| 90 | **Audit Score** | Completion audit (deterministic, log-only default) | Default pipeline |
| 92 | **Supervision Gate** | ALLOW/BLOCK review of substantive output | Default pipeline |
| 95 | **Post-Verify** | Gateway/service health checks with exponential backoff | Default pipeline |
| 5 | **Watchdog Pause** | Auto-pause before destructive operations | Planned |
| 15 | **Subagent Inject** | Inject rules into subagent prompts | Planned |
| 85 | **Memory Sync** | Sync memories on session end | Planned |

::: info
Hooks marked "Planned" are designed but not yet implemented in the default pipeline. They can be added as custom hooks when needed.
:::

## Risk Classification

The risk classifier assigns one of 5 tiers based on keyword analysis:

| Tier | Examples | Default Action |
|------|----------|---------------|
| **Tier 1** (info) | Read file, list directory | Pass |
| **Tier 2** (low) | Write file, create branch | Pass |
| **Tier 3** (medium) | Delete file, modify config | Flag |
| **Tier 4** (high) | Force push, reset, deploy | Block (enforce mode) |
| **Tier 5** (critical) | Drop database, rm -rf, destroy | Block (all modes) |

Risk classification is purely deterministic — no LLM involved. The classifier examines tool names, arguments, and patterns.

## Retry Loop

When a hook flags or blocks an operation in `enforce` mode, the retry loop manages re-attempts:

```typescript
const result = await runWithRetry({
  pipeline: defaultPipeline,
  maxAttempts: 3,
  onRetry: (attempt, reason) => {
    log(`Retry ${attempt}: ${reason}`);
  },
});
```

The attempt tracker counts retries per session and per turn, preventing infinite retry loops.

## Circuit Breaker

The circuit breaker tracks consecutive hook failures and degrades enforcement when the system appears unhealthy:

```
Closed (normal) → Open (tripped) → Half-Open (testing) → Closed
```

| State | Behavior |
|-------|----------|
| **Closed** | Normal operation, hooks enforce as configured |
| **Open** | Degraded — `advise`/`enforce` modes drop to `log` |
| **Half-Open** | Testing recovery, first success resets to closed |

Configuration:

- **Failure threshold** — consecutive failures before tripping (default: 3)
- **Cooldown period** — time before attempting recovery
- **Alert callback** — optional notification when tripped

```typescript
const breaker = new CircuitBreaker({
  failureThreshold: 3,
  cooldownMs: 60_000,
  onTrip: () => alertEngine.emit('circuit-breaker-tripped'),
});
```

## Supervision Gate

The supervision gate is a special hook factory for `ALLOW`/`BLOCK` decisions:

```typescript
const gate = createSupervisionGate({
  rules: [
    { pattern: /rm -rf/, action: 'BLOCK' },
    { pattern: /git push --force/, action: 'BLOCK' },
    { pattern: /npm publish/, action: 'BLOCK' },
  ],
});
```

## Custom Hooks

You can register custom hooks with the hook bus:

```typescript
hookBus.register({
  name: 'my-custom-hook',
  priority: 30,
  mode: 'warn',
  async check(ctx) {
    if (ctx.toolName === 'dangerous-tool') return 'flag';
    return 'pass';
  },
});
```

Custom hooks participate in the same pipeline as built-in hooks and produce the same trace entries.

## Roundtable Multi-Agent Discussions

The roundtable hook (priority 50) orchestrates structured multi-agent discussions. When a trigger phrase is detected, the hook initializes a discussion session with turn management, mode assignment, and round tracking.

The interagent-routing hook (priority 2) is roundtable-aware — it allows agent messages through without `@mention` when a roundtable is active, preventing the bot→bot suppression from blocking discussion turns.

### Trigger Phrases

Any of these in a message starts a new roundtable:

- `let's discuss ...`
- `roundtable: ...`
- `@roundtable ...`
- `debate this ...`

### Configuration

Triggers can include inline configuration:

```
roundtable: Should we refactor the auth layer? agents: claude, gemini, codex rounds: 3
```

If agents or rounds aren't specified, the hook falls back to configured defaults (2 rounds, current adapter). Duplicate agent names are automatically deduplicated.

### Agent Modes

The first two agents are assigned contrasting roles:

| Agent | Mode |
|-------|------|
| First | **advocate** — argues in favor |
| Second | **critic** — argues against |
| Others | **neutral** — balanced perspective |

### Discussion Lifecycle

```
Trigger detected → active (agents take turns per round)
    → all rounds complete → synthesizing (summary phase)
    → synthesis message arrives → complete
```

In `enforce` mode, out-of-turn messages are blocked. In `log`/`advise` modes, out-of-turn messages are allowed but recorded separately — the turn index is not advanced, so the expected agent still gets their turn.

### Metadata Injection

While active, the roundtable hook injects metadata for downstream hooks and adapters:

| Key | Description |
|-----|-------------|
| `roundtable` | `true` when a discussion is active |
| `roundtableId` | Unique session identifier |
| `currentAgent` | Which agent should speak next |
| `currentRound` | Current round number |
| `mode` | The current agent's assigned mode |

## Task Delegation

ARC includes a first-class task delegation protocol (`TaskDelegator`) that enables agent-to-agent work handoff with validated status transitions:

```
Agent A delegates → Task created + assigned → Handoff message sent
Agent B accepts → Task working → Completes with output
Agent A notified → Reads result
```

### Delegation Flow

```typescript
const delegator = new TaskDelegator(taskStore, messageBus);

// Agent A delegates to Agent B
const { task } = await delegator.delegate({
  from: 'claude-work',
  to: 'codex-review',
  description: 'Review auth refactor PR',
  priority: 'high',
  onComplete: (task) => console.log('Done:', task.output),
  listenerTimeoutMs: 300_000, // 5 min TTL on listener
});

// Agent B accepts and completes
await delegator.accept(task.id, 'codex-review');
await delegator.complete(task.id, 'codex-review', 'LGTM — no issues found');
```

### Input Requests

When a task needs more information:

```typescript
// Assignee requests input
await delegator.requestInput(task.id, 'codex-review', 'Which files should I focus on?');

// Delegator provides it (transitions input-required → working)
await delegator.provideInput(task.id, 'claude-work', 'Focus on src/auth/ directory');
```

### Status Transitions

Tasks follow a validated state machine — invalid transitions throw errors:

```
created → assigned → working → completed | failed
                       ↕
                  input-required
```

### Guards

- **Self-delegation** is blocked (`from === to` throws)
- **Listener TTL** prevents memory leaks from tasks that never complete
- **`dispose()`** cleans up all active listeners when the delegator is destroyed
