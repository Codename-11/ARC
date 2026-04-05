# Hooks & Supervision

ARC includes a supervision pipeline that runs hooks before and after agent actions. Hooks classify risk, detect patterns, audit completions, and optionally block dangerous operations. This page covers how to configure and use hooks from a user perspective. For architecture details, see [Hook Pipeline](/architecture/hooks).

## Enforcement Modes

Each profile has an enforcement mode that controls how hook results are applied:

| Mode | Behavior |
|------|----------|
| `off` | Hooks are not executed |
| `log` | Hooks run and results are logged, but nothing is blocked |
| `advise` | Hooks run and inject suggestions into metadata, but never block |
| `enforce` | Hooks run and can block actions when a check fails |

The default enforcement mode is `log`. Set it per profile:

```json
{
  "name": "my-profile",
  "tool": "claude",
  "enforcement": "enforce"
}
```

## Built-in Hooks

ARC ships with a default hook pipeline that runs in priority order:

| Priority | Hook | Purpose |
|----------|------|---------|
| 1 | Source Classify | Identifies message origin (user, system, cron, agent) |
| 2 | Interagent Routing | Suppresses bot-to-bot message loops |
| 10 | Risk Detection | Classifies messages into 5 risk tiers |
| 20 | Attempt Tracker | Counts retries per session and turn |
| 50 | Roundtable | [Multi-agent discussion](/features/orchestration#roundtable-discussions) orchestration |
| 90 | Audit Score | Deterministic completion audit on agent output |
| 92 | Supervision Gate | ALLOW/BLOCK review of substantive output |
| 95 | Post Verify | Health polling after service operations |

## Risk Tiers

The risk detection hook classifies each action into one of five tiers:

| Tier | Examples | Confirmation Required |
|------|----------|-----------------------|
| `read-only` | File reads, searches, listing | No |
| `file-modification` | Writing files, editing code | No |
| `build-affecting` | Running builds, installing packages | No |
| `deploy-affecting` | Deployments, publishing packages | Yes |
| `destructive` | Deleting files, force-pushing, resetting | Yes |

Higher-risk tiers trigger stricter checklist intensity (`light`, `standard`, or `strict`) in the audit pipeline.

## Circuit Breaker

When hooks fail repeatedly, ARC's circuit breaker degrades enforcement to prevent hooks from blocking all work. After 3 consecutive hook failures, the effective enforcement mode is downgraded automatically. The breaker resets when hooks start succeeding again.

This ensures that a flaky hook does not permanently block agent launches.

## Configuring Hooks Per Profile

Individual hooks can be enabled, disabled, or given custom timeouts in the profile configuration:

```json
{
  "name": "strict-profile",
  "tool": "claude",
  "enforcement": "enforce",
  "hooks": {
    "risk-detection": { "enabled": true, "timeout": 10000 },
    "interagent-routing": { "enabled": false },
    "supervision-gate": { "enabled": true, "timeout": 5000 }
  }
}
```

### Hook Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Whether the hook runs |
| `timeout` | `number` | `5000` | Max execution time in milliseconds |

## Pipeline Events

Hooks subscribe to lifecycle events:

- **pre-message** — before a message is sent to the agent
- **post-message** — after the agent responds
- **pre-launch** — before an agent process is spawned
- **post-launch** — after the agent process exits

## Viewing Hook Activity

Hook results are written to the structured log. Review them with:

```bash
arc logs --component hooks
arc logs --component launch --action hook:block
```

In `enforce` mode, blocked actions include the hook name and reason in the error output.
