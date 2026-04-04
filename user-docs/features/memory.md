# Memory

ARC's memory system stores observations, corrections, preferences, and facts that persist across sessions. Memories are scoped, typed, and scored by relevance using exponential decay.

## Searching Memory

```bash
arc memory search "deployment process"
arc memory search "react hooks" --scope persistent
```

Search uses deterministic keyword/scope/type/recency ranking. More recent and more frequently accessed memories score higher.

## Listing Memories

```bash
arc memory list
arc memory list --scope persistent
arc memory list --scope persistent --type correction
arc memory list --type preference
```

## Memory Properties

### Scopes

| Scope | Lifetime | Description |
|-------|----------|-------------|
| `session` | Cleared on exit | Ephemeral, per-session observations |
| `persistent` | Survives restarts | Durable cross-session knowledge |
| `shared` | Synced across profiles | Available to all profiles via the shared layer |

### Types

| Type | Description | Example |
|------|-------------|---------|
| `observation` | General observation | "This project uses pnpm, not npm" |
| `correction` | Corrected behavior | "User prefers tabs over spaces" |
| `preference` | Explicit preference | "Always use conventional commits" |
| `fact` | Factual knowledge | "API rate limit is 100 req/min" |

## Relevance Scoring

Memories use an **exponential decay** scoring model. Each memory has a relevance score that decays over time, with a configurable half-life. Accessing a memory boosts its score.

```bash
arc memory stats          # See score distribution
arc memory prune --threshold 0.1
```

The `decayScore()` function computes relevance as:

```
score = base_score * (0.5 ^ (age / half_life)) + access_boost
```

Memories below the prune threshold are removed. Check the distribution with `arc memory stats` before pruning.

## Auto-Extraction

ARC can automatically extract memories from agent conversations. The `extractMemories()` heuristic detects:

- **Corrections** — when the user corrects an agent's behavior
- **Preferences** — explicit user preferences mentioned in conversation
- **Patterns** — recurring patterns in tool usage or workflow
- **Decisions** — architectural or design decisions

Extracted memories are stored as `persistent` scope entries and surface in future sessions when relevant keywords match.

## Storage

- **Session memory** — in-memory `Map`-backed, cleared on process exit
- **Persistent memory** — JSON file-backed at `~/.arc/memory/`
- **Shared memory** — linked via junction/symlink to `~/.arc/shared/memory/`

The web dashboard exposes memory via the `/api/memory` REST endpoint.
