# Skills

Skills are declarative descriptions of workflows, patterns, or domain knowledge that extend agent capabilities. They sit above tools in the abstraction hierarchy — a tool is a single action, a skill is a multi-step workflow.

## Listing Skills

```bash
arc skills list
arc skills info code-review
```

## Loading Skills

Load skills from a directory containing JSON skill files:

```bash
arc skills load ~/.arc/skills/
arc skills load ./project-skills/
```

Loaded skills are registered globally and available to all profiles.

## Skill Format

Skill files are plain JSON with a `name`, `description`, and `instructions` field:

```json
{
  "name": "code-review",
  "description": "Perform a thorough code review with security and performance checks",
  "trigger": "review",
  "instructions": [
    "Check for security vulnerabilities (injection, auth bypass, secrets in code)",
    "Check for performance issues (N+1 queries, unnecessary re-renders, memory leaks)",
    "Check for correctness (edge cases, error handling, type safety)",
    "Suggest improvements with code examples"
  ],
  "steps": [
    { "action": "read", "target": "changed files" },
    { "action": "analyze", "criteria": ["security", "performance", "correctness"] },
    { "action": "report", "format": "inline comments + summary" }
  ]
}
```

## MCP-to-Skill Adapters

Any MCP tool can be wrapped as a skill using `mcpToSkill()`. This lets you compose MCP tools into higher-level workflows:

```typescript
import { mcpToSkill } from '@axiom-labs/arc-core';

const skill = mcpToSkill({
  name: 'deploy-check',
  tool: 'run-tests',
  server: 'ci-server',
  preCondition: 'all tests pass',
  postAction: 'notify team',
});
```

## Skillify <Badge type="tip" text="self-improving" />

Skillify is a meta-skill where the agent creates new skill definitions from its own actions. When the agent performs a multi-step workflow, skillify can capture it as a reusable skill.

The `generateSkillFromPattern()` function detects repeated action sequences and proposes skill definitions:

```bash
# Skillify observes repeated patterns and suggests:
# "You've performed this 3-step deploy workflow 5 times.
#  Save as a skill called 'safe-deploy'?"
```

## Stuck Detector

The stuck detector monitors agent actions for signs of looping or unproductive behavior:

- **Repeated patterns** — sliding window detection of repeated action sequences
- **Jaccard similarity** — compares recent actions to detect cycling
- **Recovery strategies** — cycles through different recovery approaches (rephrase, simplify, escalate)

```typescript
const detector = new StuckDetector({
  windowSize: 10,
  similarityThreshold: 0.8,
});

// Returns recovery suggestion if stuck
const recovery = detector.check(recentActions);
```

When an agent appears stuck, ARC can automatically suggest a different approach or escalate to the user.

## TUI Skills View

The TUI Skills view displays real skill data from the SkillRegistry.

| Key | Action |
|-----|--------|
| `r` | Reload all skills from disk |
| `i` | Show detailed info for the selected skill |

The view lists each skill's name, description, trigger keyword, and step count.

## Web Dashboard Skill Management

The [Web Dashboard](/features/dashboard) Skills view provides skill management through a browser interface:

- **Browse** — view all loaded skills with trigger info and step details
- **Reload** — reload skills from disk (equivalent to `arc skills load`)
- **Remove** — unregister a skill from the registry

Changes are broadcast over WebSocket so connected clients see updates immediately.

::: tip
The CLI provides the most complete skill management (load from arbitrary directories, register new skills). The TUI and Web Dashboard support reading the registry plus reload and remove operations.
:::

## Skill Registry

The `SkillRegistry` manages skill lifecycle:

- **register** — add a skill definition
- **unregister** — remove a skill
- **findByTrigger** — match skills by trigger keyword

Skills are loaded at startup from `~/.arc/skills/` and any directories specified in the profile or workspace config.
