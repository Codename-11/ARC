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

## Built-In Hooks

| Priority | Hook | Description |
|----------|------|-------------|
| 1 | **Source Classifier** | Deterministic message source detection (human/agent/system/cron) |
| 2 | **Interagent Routing** | Suppress bot-to-bot loops in multi-agent setups |
| 5 | **Watchdog Pause** | Auto-pause before destructive operations |
| 10 | **Risk Detection** | 5-tier keyword-based risk classification |
| 15 | **Subagent Inject** | Inject rules into subagent prompts |
| 20 | **Attempt Tracker** | Session + turn scoped retry counting |
| 50 | **Roundtable** | Multi-agent orchestration advancement |
| 85 | **Memory Sync** | Sync memories on session end |
| 90 | **Audit Score** | Completion audit (LLM-enhanced, log-only default) |
| 95 | **Post-Verify** | Gateway/service health checks with exponential backoff |

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
