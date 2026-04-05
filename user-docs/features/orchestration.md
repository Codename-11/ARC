# Multi-Agent Orchestration

ARC's orchestration layer lets you coordinate multiple agents — across different models, profiles, and machines — for discussions, code reviews, audits, and task delegation.

The key insight: **each ARC profile is an agent identity**. A profile bundles a model (Claude, Gemini, Codex, etc.), credentials, enforcement settings, and hook config. When you put multiple profiles in a roundtable or delegate tasks between them, you get cross-model collaboration out of the box.

## How It Works

ARC provides two orchestration primitives:

| Primitive | Purpose | Scale |
|-----------|---------|-------|
| **Roundtable** | Structured multi-agent discussion with turns and roles | 2-10 agents, synchronous |
| **Task Delegation** | Hand off work from one agent to another with tracking | 1:1, async |

Both work through the hook pipeline and message bus — no external services required.

## Roundtable Discussions

Start a structured discussion between agents. Each agent gets a role (advocate, critic, or neutral) and takes turns responding across multiple rounds.

### Quick Start

```
roundtable: Should we use a monorepo or polyrepo? agents: claude, gemini, codex rounds: 3
```

This creates a 3-round discussion where:
- **claude** argues as the **advocate** (first agent)
- **gemini** argues as the **critic** (second agent)
- **codex** provides a **neutral** perspective

### Trigger Phrases

Any of these start a roundtable:

- `roundtable: <topic>`
- `let's discuss <topic>`
- `@roundtable <topic>`
- `debate this <topic>`

Add `agents: a, b, c` and/or `rounds: N` to configure inline.

### Discussion Flow

```
Trigger → Active → Round 1 (each agent speaks) → Round 2 → ... → Synthesize → Complete
```

<ArcFlow diagram="roundtable" height="200px" />

After all rounds, the discussion enters a synthesis phase where the accumulated responses are available for a final summary.

### Use Cases

**Architecture review** — Get three perspectives on a design decision:
```
roundtable: Should we migrate from REST to GraphQL? agents: claude, gemini rounds: 2
```
Claude advocates for the change while Gemini critiques it. After 2 rounds, you get a balanced view without having to manually prompt each model.

**Code audit** — Multiple models review the same code:
```
roundtable: Review the auth middleware for security issues agents: claude, codex, gemini rounds: 1
```
Each model examines the code from its strengths — Claude for reasoning, Codex for patterns, Gemini for breadth.

**Refactor strategy** — Debate approach before committing:
```
let's discuss whether to refactor User into separate UserAuth and UserProfile classes agents: claude, gemini rounds: 2
```

**Cross-model comparison** — See how different models approach the same problem:
```
@roundtable Implement a rate limiter for our API agents: claude, codex rounds: 1
```
Compare the implementations side-by-side.

### Enforcement Modes

| Mode | Out-of-turn messages |
|------|---------------------|
| `log` | Allowed, recorded separately |
| `advise` | Allowed with a warning flag |
| `enforce` | Blocked — agents must wait their turn |

In `log` and `advise` modes, out-of-turn messages are recorded under the actual agent's name, and the expected agent still gets their turn. This makes roundtables work even in loosely coordinated setups.

## Task Delegation

Delegate specific tasks from one agent to another. The delegating agent creates a task, assigns it, and gets notified when it's done.

### Quick Start

```typescript
const delegator = new TaskDelegator(taskStore, messageBus);

// Claude delegates a review to Codex
const { task } = await delegator.delegate({
  from: 'claude-work',
  to: 'codex-review',
  description: 'Review the auth refactor PR for correctness',
  priority: 'high',
  onComplete: (t) => console.log('Review done:', t.output),
});
```

### Delegation Flow

```
Delegator creates task → Assigns to target → Sends handoff message
                                                      ↓
                                              Target accepts
                                                      ↓
                                              Target works on it
                                                      ↓
                                              Target completes
                                                      ↓
                                          Delegator gets notified
```

<ArcFlow diagram="delegation" height="300px" />

### Use Cases

**Code review by a different model** — Have Gemini review code written by Claude:
```typescript
await delegator.delegate({
  from: 'claude-work',       // wrote the code
  to: 'gemini-review',      // reviews it
  description: 'Review PR #42 for edge cases and error handling',
  priority: 'high',
});
```

**Parallel subtasks** — Break a large task into pieces:
```typescript
// Claude coordinates, delegates to specialists
await delegator.delegate({
  from: 'claude-lead',
  to: 'codex-tests',
  description: 'Write unit tests for src/auth/',
});

await delegator.delegate({
  from: 'claude-lead',
  to: 'gemini-docs',
  description: 'Update API documentation for the auth endpoints',
});
```

**Audit pipeline** — Chain reviews:
```typescript
// Step 1: Claude writes, delegates to Codex for review
const { task } = await delegator.delegate({
  from: 'claude-work',
  to: 'codex-review',
  description: 'Security audit of the payment module',
  onComplete: async (reviewed) => {
    // Step 2: If Codex approves, send to Gemini for a second opinion
    await delegator.delegate({
      from: 'claude-work',
      to: 'gemini-audit',
      description: `Verify Codex review: ${reviewed.output}`,
    });
  },
});
```

**Interactive delegation** — When the assigned agent needs clarification:
```typescript
// Codex is working and needs more info
await delegator.requestInput(task.id, 'codex-review', 'Should I focus on SQL injection or XSS?');

// Claude (the delegator) responds
await delegator.provideInput(task.id, 'claude-work', 'Focus on SQL injection in the query builder');
// Task automatically resumes (input-required → working)
```

### Task Status Flow

```
created → assigned → working → completed
                       ↕           or
                  input-required → failed
```

Invalid transitions are blocked — you can't jump from `created` straight to `completed`.

### Safety Guards

- **No self-delegation** — `from` and `to` must be different profiles
- **Listener TTL** — set `listenerTimeoutMs` to auto-cleanup if a task never finishes
- **Cleanup** — call `delegator.dispose()` when done to free all listeners

## Combining Roundtable + Delegation

The two primitives compose naturally:

1. **Discuss first, then delegate** — Run a roundtable to decide on an approach, then delegate the implementation:
   ```
   roundtable: How should we handle rate limiting? agents: claude, gemini rounds: 2
   ```
   After synthesis, delegate the chosen approach to the best-suited agent.

2. **Delegate with review roundtable** — Delegate implementation, then roundtable the result:
   ```typescript
   await delegator.delegate({
     from: 'claude-lead',
     to: 'codex-impl',
     description: 'Implement the rate limiter',
     onComplete: () => {
       // Roundtable the result
       // "roundtable: Review the rate limiter implementation agents: claude, gemini rounds: 1"
     },
   });
   ```

3. **Dark Factory + Delegation** — In [Dark Factory](/features/factory) mode, waves of tasks use delegation under the hood. Each wave's tasks are assigned to profiles, and consensus gates use roundtable-style multi-agent review.

## Profile Setup for Multi-Agent

To use orchestration, you need multiple profiles. Each profile is an independent agent identity:

```bash
# Create profiles for different models
arc profile create claude-lead --tool claude --auth api-key
arc profile create gemini-review --tool gemini --auth oauth
arc profile create codex-impl --tool codex --auth api-key

# Or for same model, different configs
arc profile create claude-strict --tool claude --auth api-key
# Then set enforcement: "enforce" in its config
```

Profiles can use the **same model with different settings** (e.g., one Claude profile with `enforce` mode for auditing, another with `log` mode for development) or **different models entirely**.

::: tip
You don't need all tools installed to delegate. If a target profile's tool isn't installed, the task stays in `assigned` until that agent comes online. This works well with [Remote Agents](/features/remote) on other machines.
:::

## Interagent Routing

When agents communicate, the interagent-routing hook prevents infinite bot-to-bot message loops. It blocks agent messages that don't contain an `@mention` — unless a roundtable is active, in which case all participants can speak freely.

| Scenario | Behavior |
|----------|----------|
| User sends a message | Always allowed |
| Agent sends with `@mention` | Always allowed |
| Agent sends during active roundtable | Allowed (roundtable bypass) |
| Agent sends without `@mention`, no roundtable | Suppressed (blocked in enforce mode) |

This means you can safely enable multi-agent features without worrying about message storms.

## Web Dashboard Visibility

The [Web Dashboard](/features/dashboard) provides several views for monitoring orchestration in real time:

- **Hook Pipeline Monitor** — see which hooks are firing, pass/flag/block decisions per agent, interagent routing suppressions, and risk classifications
- **Agents View** — verify all participating remote agents are reachable; add, remove, and health-check from the browser
- **Factory View** — live wave progression, per-task status, and consensus gate results during Dark Factory runs
- **Overview** — hook pipeline summary card showing enforcement mode and recent decision counts

::: tip
For full control over orchestration configuration (enforcement modes, hook timeouts, roundtable parameters), use the CLI or profile configuration files. The Web Dashboard provides monitoring and visibility.
:::
