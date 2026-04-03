# Inherited Patterns from Axiom-Supervisor

> ARC absorbs Axiom-Supervisor entirely. This document preserves the technical patterns,
> type contracts, and design decisions that inform ARC's implementation.
> 
> Source: `~/axiom-supervisor/docs/` + `openclaw/` plugin code (archived 2026-04-02)

---

## Core Design Principle

**"Deterministic heuristics first, LLM optional."**

The entire supervision core runs without an LLM. Only `expandIntent()` uses one, and only when an `LLMCompleteFn` is provided. Everything else — risk classification, checklist derivation, audit, scope tracking — is pure heuristics. This means:
- Zero API cost for supervision
- Predictable, testable behavior
- No latency from LLM roundtrips in the critical path

```typescript
type LLMCompleteFn = (prompt: string, systemPrompt: string) => Promise<string>;
```

This is the ONLY LLM interface. Trivially mockable. ARC should preserve this pattern — supervision logic should never require an LLM to function.

---

## Data Flow

```
User Message → expandIntent() → TaskBrief
            → classifyRisk() → RiskClassification
            → deriveChecklist() → CompletionChecklist
            → shouldPause? → boolean
            → [Agent Executes]
            → auditCompletion() → CompletionAudit
            → evaluateScope() → ScopeTracker
            → buildTrace() → DebugTrace
```

All adapters extend `BaseAdapter` which implements this shared preflight/postflight pipeline. Adapters only translate between their runtime's conventions and core types.

---

## Risk Classification (5 Tiers)

| Tier | Confirmation | Checklist Intensity | Example Keywords |
|------|-------------|-------------------|-----------------|
| `read-only` | No | light | explain, search, list, show |
| `file-modification` | No | standard | edit, fix, refactor, create, write |
| `build-affecting` | No | standard | npm install, tsconfig, dockerfile |
| `deploy-affecting` | Yes | strict | deploy, release, merge to main |
| `destructive` | Yes | strict | force push, rm -rf, drop table |

### Known Heuristic Gaps (Carry Forward to ARC)
- Substring matching produces false positives ("explain the deployment" → `deploy-affecting`)
- False-completion detection is regex-based, misses subtle claims
- Description-only detection is broad, flags legitimate read-only explanations

### Planned Mitigations
- Word-boundary matching instead of substring
- Intent-aware verb classification
- Negation detection ("do NOT deploy")
- Compound expression parsing ("run tests AND deploy")
- Weighted keyword position (verbs at start = stronger signal)

---

## Core Type Contracts

### TaskBrief
Intent, scope, constraints, risk level, assumptions, done criteria. Produced by `expandIntent()`.

### RiskClassification
```typescript
interface RiskClassification {
  tier: 'read-only' | 'file-modification' | 'build-affecting' | 'deploy-affecting' | 'destructive';
  reasons: string[];
  requiresConfirmation: boolean;
  checklistIntensity: 'light' | 'standard' | 'strict';
}
```

### CompletionAudit
```typescript
interface CompletionAudit {
  status: 'complete' | 'partial' | 'failed' | 'uncertain';
  checksPassed: string[];
  checksFailed: string[];
  missingSteps: string[];
  overreachDetected: boolean;
  confidence: number;
  recommendation: 'complete' | 'continue' | 'retry' | 'escalate';
}
```

### Audit → Recommendation Matrix

| Audit Status | Confidence ≥ 0.3 | Confidence < 0.3 |
|-------------|-------------------|-------------------|
| `complete` | `complete` | `complete` |
| `partial` | `continue` | `continue` |
| `failed` | `retry` | `escalate` |
| `uncertain` | `continue` | `escalate` |

### ScopeTracker
```typescript
interface ScopeTracker {
  predictedFiles: string[];
  predictedSurfaces: string[];
  actualFiles: string[];
  actualSurfaces: string[];
  unexpectedFiles: string[];
  missingFiles: string[];
  scopeCreepSeverity: 'none' | 'minor' | 'major';
}
```

**Scope Creep Rules:**
- `none`: no unexpected files
- `minor`: some unexpected, <50% of total
- `major`: >50% unexpected, or >2 unexpected surfaces

**Overreach flag:** severity `major` OR >3 unexpected files in non-read-only context.

### Confidence Scoring
- Deterministic intent: 0.4
- Risk classification: always 1.0
- Each contradiction reduces by 0.1

### DebugTrace
Full audit trail: brief, risk, checklist, audit, scope, rationale snippets, confidence levels. Written to `trace-<uuid>.json` per run.

---

## Self-Retry Protocol

Critical behavioral contract — ARC agents should follow this:

1. **Before any task:** `classify_risk` → `expand_intent` → use `doneCriteria` / `requiredValidation`
2. **After task:** `audit_completion` with taskBrief + executionResult
3. **Self-retry loop:** If audit ≠ "complete", read `checksFailed` / `missingSteps`, fix them, re-audit
   - **Never ask user "should I continue?"** — retry autonomously
   - Max 3 attempts, then report remaining issues
4. **Stop conditions:** audit "complete", 3 attempts reached, or missing information that requires user input

---

## Adapter-Specific Patterns

### Claude Code (SDK + Hooks)
- `withSupervisor()` convenience wrapper for full lifecycle
- `strictMode` throws on `shouldPause` (blocks destructive operations)
- Local trace file writing per-run
- Manual hooks for custom pause handling

### Codex CLI (Sidecar File Protocol)
- `.axiom-supervisor/` directory with JSON files:
  - `latest-task-brief.json`
  - `latest-risk-classification.json`
  - `latest-audit.json`
  - `latest-trace.json`
- Hook runner: reads stdin/args, emits augmented prompt on stdout, summaries on stderr
- `axiom install` — permanently registers MCP + skill
- `axiom launch` — one session
- `axiom exec` — single task with external retry

### OpenClaw Plugin (Lifecycle Hooks)
- 3 lifecycle hooks: `before_prompt_build`, `agent_end`, `session_end`
- **Enforced retry loop** in `agent_end`: returns `{ continue: true, continueReason: "..." }` with structured feedback
- Per-session degradation tracking via in-memory `Map<sessionId, PluginState>`
- Session bridge with hygiene checks:
  - `degradationThreshold`: 3 (max retries before degraded)
  - `maxHistoryMessages`: 50
  - `bloatThresholdMessages`: 200
  - `staleThresholdMs`: 30 minutes

### Generic HTTP Adapter
5 REST endpoints: `/preflight`, `/postflight`, `/classify-risk`, `/explain`, `/health`
Stateless. Any HTTP client (Python/Go/Ruby/curl).

### MCP Server
5 tools via stdio transport:
- `expand_intent`, `classify_risk`, `derive_completion`, `audit_completion`, `explain_trace`
- All deterministic, no LLM required

---

## Session Management

### SessionStore Interface
```typescript
interface SessionStore {
  getMessages(sessionId: string): Promise<SessionEntry[]>;
  getRecentMessages?(sessionId: string, limit: number): Promise<SessionEntry[]>;
  getSessionMetrics?(sessionId: string): Promise<{
    totalMessages: number;
    systemMessages?: number;
    latestTimestamp?: number;
  }>;
  getSessionSize?(sessionId: string): Promise<number>;
}
```

### Session Degradation
Per-session state tracking:
```typescript
interface PluginState {
  lastAuditStatus: string;
  latestSummary: string;
  sessionDegraded: boolean;
  auditAttempts: number;
  updatedAt: number;
}
```

Bad sessions don't contaminate others. Degradation is keyed per `sessionId`.

---

## Test Corpus (To Migrate)

- **212 unit tests** — core logic, heuristics, type contracts
- **480 e2e scenario tests** — across 23-fixture prompt corpus
- **9-task Codex benchmark harness** — completion quality measurement
- **Behavioral signal detection:** asked-to-continue, false-done, timeout, wrong-files

---

## Infrastructure Worth Preserving

- SQLite schema: `traces`, `benchmark_runs`, `benchmark_tasks`, `config` tables
- Dashboard patterns: risk distribution charts, audit history, behavioral signals, provider comparison
- Alert engine: configurable thresholds, auto-triggers on trace insert
- Per-project config: `.axiom-supervisor/config.json` pattern → maps to `arc.json`

---

*This document is a reference for ARC implementation. The patterns described here are the foundation
that ARC's hook pipeline, risk classification, and audit systems build upon.*
