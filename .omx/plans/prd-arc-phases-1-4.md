# ARC Phases 1-4 — Deliberate RALPLAN-DR Plan

## RALPLAN-DR Summary

### Principles
1. Preserve current ARC CLI/TUI behavior while extracting architecture behind stable seams.
2. Separate tool-agnostic core logic from tool-specific behavior before adding new adapters.
3. Favor incremental compatibility layers over big-bang rewrites to keep E2E coverage green through each phase.
4. Use file-based logging and process lifecycle primitives first; defer heavier persistence or orchestration until later phases justify them.
5. Make every phase independently shippable with explicit rollback boundaries.

### Decision Drivers
1. Current ARC is a single TypeScript package with tool-specific logic spread across core flows (`src/auth.ts`, `src/commands/profile.ts`, `src/commands/launch.ts`).
2. Existing CLI/TUI and Vitest coverage provide a working baseline that should be preserved during structural change.
3. Phases 1-4 add platform seams (workspaces, adapters, lifecycle, logging) that must support later multi-tool growth without forcing a user-visible rewrite now.

### Viable Options
| Option | Summary | Pros | Cons |
| --- | --- | --- | --- |
| A. Big-bang monorepo + adapter rewrite | Move everything to workspaces and rewrite call sites in one pass | Clean end state faster | Highest regression risk; hard to bisect failures; conflicts with preserve-behavior principle |
| B. Incremental compatibility monorepo (chosen) | Create workspaces, extract shared core behind compatibility exports, then migrate command/TUI call sites phase by phase | Lowest migration risk; enables phased verification; keeps CLI stable | Temporary duplication/shims during migration |
| C. Stay single-package and add folders only | Simulate packages inside `src/` without real workspaces | Lowest upfront churn | Delays real dependency boundaries; weakens later adapter/logging isolation |

**Chosen direction:** Option B.

**Invalidated alternatives:**
- Option A rejected because phases 2-4 depend on behavior staying stable while architecture changes under it.
- Option C rejected because phase 1 explicitly requires monorepo setup and would leave adapter/lifecycle boundaries porous.

## Requirements

### Functional
- Phase 1: establish monorepo/workspace structure and migrate current core + profile logic out of the single-package `src/` layout.
- Phase 2: introduce an adapter interface and ship a Claude Code adapter that absorbs current Claude-specific import/auth/launch assumptions.
- Phase 3: replace the minimal append-only logger in `src/log.ts` with a structured logging framework and add an `arc logs` command.
- Phase 4: add app-wide graceful shutdown handling plus health checks, grounded in current launch, TUI teardown, and doctor flows.

### Non-functional
- Preserve existing top-level CLI behavior from `src/cli.ts` and current TUI entry flow from `src/tui/render.tsx`.
- Keep current Node/TypeScript toolchain (`package.json`, `tsconfig.json`, `vitest.config.ts`) unless a workspace split requires minimal root/package config expansion.
- Avoid new runtime dependencies unless execution proves the standard library is insufficient.
- Maintain Windows support, especially around launch/shutdown behavior and config path handling.

## Assumptions / Unknowns

### Assumptions
- Root publishing model remains one user-facing `arc` binary even after workspace extraction.
- File-based logging remains acceptable for phase 3; no SQLite or external daemon is required yet.
- Existing integration/E2E tests are the baseline regression suite and will be expanded rather than replaced.
- `arc doctor` remains the broad diagnostic surface; a narrower health surface can be introduced if it reuses the same underlying checks.

### Unknowns
- Exact target workspace names and publish boundaries are not pre-decided in repo docs.
- Health-check UX is unspecified: separate `arc health` command vs. extending `arc doctor` with machine-readable mode.
- Adapter contract breadth is unspecified: only profile/auth/import/launch in phases 1-4, or also diagnostics/logging hooks.
- There is an existing extra worktree (`.claude/worktrees/agent-ae679759`); parallel execution should avoid shared-branch collisions.
- `.subframe/STRUCTURE.json`, `.subframe/PROJECT_NOTES.md`, and `.subframe/tasks.json` were not present in this checkout during planning, so SubFrame bookkeeping requirements cannot yet be grounded from repo files.

## Acceptance Criteria

### Phase 1 — Monorepo setup + migrate core/profiles
- Root repository uses workspaces with one app package for the CLI/TUI surface and at least one core package for shared domain logic.
- Current config/profile/auth/path primitives from `src/config.ts`, `src/types.ts`, `src/auth.ts`, and related helpers are moved behind package boundaries without changing existing CLI semantics.
- Existing commands that manage profiles (`src/commands/profile.ts`, `src/commands/launch.ts`, `src/commands/doctor.ts`) build against extracted core exports instead of local single-package-only imports.
- Root build/test/typecheck commands still work from the repo root.

### Phase 2 — Adapter interface + Claude Code adapter
- A tool adapter contract exists for detect/import/auth env/launch metadata and is consumed by profile + launch flows.
- Claude-specific `.claude.json` and credential handling now lives in a Claude adapter instead of command-level conditionals.
- Existing behavior for default Claude profile creation/import/launch remains unchanged in user-facing CLI flows.
- The codebase is structurally ready for future Gemini/Codex adapters without more Claude branching in core modules.

### Phase 3 — Logging framework + `arc logs`
- Logging is centralized behind a service that supports structured event writes, bounded retention, and typed event categories.
- Existing action logging call sites migrate off the current `src/log.ts` helper with no crash-on-log-failure regressions.
- `arc logs` can read stored logs with at least one operator-friendly mode (`--limit` and/or `--json`).
- Launch, import, switch, doctor/health, and shutdown-related events are represented in the new log stream.

### Phase 4 — Graceful shutdown + health checks
- ARC registers application-wide cleanup hooks so TUI exit, interrupted launches, and process signals share a common shutdown path.
- Launch/TUI cleanup no longer relies solely on `src/tui/render.tsx` side effects for terminal restoration.
- Health checks cover config validity, binary availability, credential readability, and logger/lifecycle readiness through reusable primitives.
- CLI users have a machine-consumable health entry point or doctor mode suitable for automation.

## Implementation Steps with File Refs

### Step 1 — Freeze the current behavior and workspace migration envelope
**Goal:** protect existing behavior before structure moves.

**Primary refs:**
- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `tests/e2e/cli.test.ts`
- `tests/integration/profile.test.ts`
- `tests/integration/shared-layer.test.ts`

**Planned work:**
- Add regression coverage for any currently untested core/profile behaviors that phases 1-4 will stress: profile import edge cases, launch env assembly, doctor output invariants, and TUI teardown expectations.
- Decide root workspace orchestration shape: keep root scripts as orchestration wrappers while app/package-specific scripts live in workspace package manifests.
- Record current public command surface from `src/cli.ts` as the compatibility contract.

### Step 2 — Convert the repo to a minimal compatibility-first monorepo
**Goal:** create real package boundaries without changing runtime UX.

**Primary refs:**
- `package.json`
- `tsup.config.ts`
- `src/index.ts`
- `src/cli.ts`
- `src/paths.ts`

**Likely target additions:**
- `apps/arc-cli/package.json`
- `apps/arc-cli/src/index.ts`
- `apps/arc-cli/src/cli.ts`
- `packages/core/package.json`
- `packages/core/src/index.ts`
- root `pnpm-workspace.yaml`
- shared `tsconfig.base.json`

**Planned work:**
- Move the current user-facing CLI/TUI entry into `apps/arc-cli` while keeping the package name/bin exposed as `arc`.
- Extract tool-agnostic domain modules (`config`, `types`, `paths`, shared profile services) into `packages/core` with explicit exports.
- Keep temporary re-export shims only where needed to reduce migration churn, then remove them once all call sites are package-qualified.

### Step 3 — Migrate core + profile flows into package-owned services
**Goal:** remove profile/config/auth logic from app-local modules.

**Primary refs:**
- `src/config.ts`
- `src/types.ts`
- `src/auth.ts`
- `src/detect.ts`
- `src/import-utils.ts`
- `src/commands/profile.ts`
- `src/commands/launch.ts`
- `src/commands/doctor.ts`

**Likely target additions:**
- `packages/core/src/config/*`
- `packages/core/src/profiles/*`
- `packages/core/src/auth/*`
- `packages/core/src/detect/*`

**Planned work:**
- Split profile persistence, credential inspection, detection, and env building into core services with typed interfaces instead of command-owned helpers.
- Keep Commander handlers thin: validate args, call package services, render output.
- Ensure `doctor`, `status`, `launch`, and TUI hooks all read the same core package APIs.

### Step 4 — Introduce the adapter contract and wire core to it
**Goal:** eliminate tool-specific branching from shared flows.

**Primary refs:**
- `src/detect.ts`
- `src/auth.ts`
- `src/commands/profile.ts`
- `src/commands/launch.ts`
- `src/types.ts`

**Likely target additions:**
- `packages/core/src/adapters/types.ts`
- `packages/core/src/adapters/registry.ts`
- `packages/adapter-claude/package.json`
- `packages/adapter-claude/src/index.ts`

**Planned work:**
- Define an adapter interface that covers: tool identity, config dir detection, importable file rules, auth inspection, launch env shaping, install hints, and optional health checks.
- Add a registry in core so app commands can resolve an adapter from profile tool name.
- Keep the contract narrow enough for phases 1-4; do not prematurely model features not yet needed by Gemini/Codex.

### Step 5 — Move Claude-specific behavior into the Claude adapter
**Goal:** isolate current Claude assumptions without regressing behavior.

**Primary refs:**
- `src/commands/profile.ts` (special `.claude.json` import path)
- `src/auth.ts` (Claude OAuth parsing + CLAUDE auth env vars)
- `src/commands/launch.ts` (tool install hinting + env build usage)
- `src/detect.ts` (Claude signature)

**Planned work:**
- Relocate Claude credential parsing, `.claude.json` import fallback, config signatures, and env var shaping into `packages/adapter-claude`.
- Replace command-level `tool === "claude"` branches with adapter methods.
- Keep default behavior for profiles with no explicit tool set aligned to Claude until later phases change that product decision.

### Step 6 — Replace the logger with a structured logging service
**Goal:** promote logging from best-effort append helper to reusable framework.

**Primary refs:**
- `src/log.ts`
- `src/commands/launch.ts`
- `src/commands/profile.ts`
- `src/commands/doctor.ts`
- `src/paths.ts`

**Likely target additions:**
- `packages/core/src/logging/logger.ts`
- `packages/core/src/logging/events.ts`
- `packages/core/src/logging/store.ts`
- `apps/arc-cli/src/commands/logs.ts`

**Planned work:**
- Replace `logAction(action, detail?)` with typed events (`launch.started`, `launch.finished`, `profile.imported`, `health.checked`, `shutdown.signal`, etc.).
- Keep file storage under the ARC data dir and use JSONL or another append-friendly format with bounded retention.
- Add formatter/read-side helpers so `arc logs` does not parse files ad hoc inside the command.

### Step 7 — Add `arc logs` and wire operator-friendly log consumption
**Goal:** expose the new logging framework safely.

**Primary refs:**
- `src/cli.ts`
- `src/display.ts`
- `src/log.ts`

**Planned work:**
- Register `arc logs` in the main CLI with minimal flags (`--limit`, `--json`, optionally `--follow` if execution effort allows).
- Render a readable default view plus structured output for automation.
- Ensure log reads tolerate missing/corrupt files without breaking the rest of ARC.

### Step 8 — Add a lifecycle manager for graceful shutdown
**Goal:** unify exit behavior across CLI, TUI, and launched subprocesses.

**Primary refs:**
- `src/tui/render.tsx`
- `src/commands/launch.ts`
- `src/index.ts`
- `src/commands/doctor.ts`

**Likely target additions:**
- `packages/core/src/lifecycle/shutdown.ts`
- `packages/core/src/lifecycle/signals.ts`
- `packages/core/src/lifecycle/health.ts`

**Planned work:**
- Extract terminal restoration and process cleanup registration into shared lifecycle utilities.
- Register signal handlers (`SIGINT`, `SIGTERM`, Windows-safe equivalents) once at app startup and let TUI/launch code subscribe cleanup callbacks instead of owning process exit directly.
- Ensure logging flushes and terminal restoration occur in deterministic order during shutdown.

### Step 9 — Build reusable health checks and expose them through doctor/health surfaces
**Goal:** make health automation possible without duplicating doctor logic.

**Primary refs:**
- `src/commands/doctor.ts`
- `src/commands/launch.ts`
- `src/auth.ts`
- `src/config.ts`
- `src/log.ts`

**Planned work:**
- Refactor existing doctor checks into reusable core health probes (config, PATH, shell integration, binary availability, credential status, logger writable, shutdown registration sanity).
- Keep `arc doctor` as the human-readable superset.
- Add either `arc health` or `arc doctor --json` as the machine-readable health surface; prefer a separate `arc health` command if it simplifies automation without cluttering doctor UX.

## Risks
- **Workspace churn risk:** package boundary changes can break dist paths and E2E expectations that currently assume `dist/index.js` at repo root.
- **Adapter under-modeling risk:** if the contract is too narrow, Claude details will leak back into app/core code; too broad, and future adapters get forced into speculative abstractions.
- **Windows lifecycle risk:** signal semantics and `cmd /c` launch behavior may make graceful shutdown different from POSIX paths.
- **Logging migration risk:** switching formats can break current expectations around `~/.arc/activity.log` unless a compatibility read/migration path is defined.
- **TUI teardown risk:** moving cleanup out of `src/tui/render.tsx` can regress terminal restoration if shutdown ordering is wrong.
- **Concurrent execution risk:** if later team execution happens on the main checkout instead of a worktree, monorepo file moves will collide heavily.

## Verification
- `pnpm typecheck` from repo root passes after workspace migration.
- `pnpm test` from repo root passes with updated integration/E2E imports and build assumptions.
- `pnpm build` produces the CLI entry from its new app package and root command wrappers still work.
- Manual smoke checks confirm:
  - `arc --help`
  - `arc list`
  - `arc import`
  - `arc launch <profile>`
  - `arc doctor`
  - `arc logs`
  - TUI open/quit cycle leaves terminal clean.
- Shutdown tests verify process interruption restores terminal state and emits shutdown log records.

## Pre-Mortem
1. **Monorepo completes, but commands fail because import paths and build outputs drift.**
   - Mitigation: preserve root orchestration scripts, add early build/E2E checks after phase 1, and avoid moving CLI surface and core extraction in the same unverified commit.
2. **Claude adapter exists, but core commands still special-case Claude.**
   - Mitigation: explicitly grep for `tool === "claude"`, `.claude.json`, and Claude auth env constants after phase 2 and treat leftovers as blockers unless justified.
3. **Shutdown/logging changes appear correct in tests but leave real terminals dirty on Ctrl+C or child-process handoff.**
   - Mitigation: add manual signal smoke tests on Windows + POSIX, and require lifecycle logging around registration/start/cleanup to aid diagnosis.

## Expanded Test Plan

### Unit
- Config/profile persistence moved into `packages/core` keeps atomic writes and validation behavior from current `src/config.ts`.
- Adapter registry resolves known tools and returns stable install hints / env builders.
- Claude adapter covers `.credentials.json`, `.claude.json`, OAuth parsing, env sanitization, and import candidate selection.
- Logger writes typed events, enforces retention, and tolerates corrupt/missing files.
- Lifecycle manager calls registered cleanup handlers once, in order, under repeated signal/exit triggers.
- Health probes return typed results independent of CLI formatting.

### Integration
- Profile import against Claude fixtures still copies the same files and sets the same profile metadata as today.
- Launch flow builds environment from core + adapter layers and preserves existing `cmd /c` Windows behavior.
- `arc doctor` and machine-readable health surface share the same underlying probe results.
- `arc logs` reads records written by launch/profile/doctor/shutdown flows and handles empty/corrupt stores gracefully.
- Workspace package boundaries do not require consumers to reach into private file paths.

### E2E
- Root CLI help/version/list/doctor still work after workspace split.
- Creating/importing/switching/launching a Claude profile succeeds through the new adapter path.
- TUI open/quit/launch flow restores terminal state and exits with expected codes.
- `arc logs --json --limit N` returns parseable output after generating events.
- Interrupting a long-running launch path produces graceful shutdown behavior rather than a torn terminal/session.

### Observability / Diagnostics
- Log schema includes event name, timestamp, severity/category, and enough context to correlate profile/tool/shutdown activity.
- Health command/doctor JSON output is stable enough for automation snapshots.
- Failures in logging never crash user commands, but emit detectable fallback behavior for tests.
- Shutdown path emits start/success/failure lifecycle events to aid future debugging.

## ADR

### Decision
Adopt an incremental compatibility-first monorepo with a shared core package, a dedicated Claude adapter package, structured file-based logging, and a centralized lifecycle/health layer for phases 1-4.

### Drivers
- Current code centralizes tool-neutral and tool-specific concerns in the same command modules.
- The roadmap needs real package boundaries before multiple adapters, lifecycle hooks, and logs can scale.
- Existing CLI/TUI behavior is already usable and should remain the external contract during migration.

### Alternatives Considered
1. **Big-bang rewrite into a full workspace architecture in one pass** — rejected for regression and rollback risk.
2. **Single-package refactor with internal folders only** — rejected because it would not create enforceable boundaries for later phases.
3. **Introduce logging/lifecycle changes before adapters** — rejected because tool-specific logic would still be spread across commands, making later extraction harder.

### Why Chosen
This sequence creates the smallest stable seams first, lets each phase build on an explicit boundary, and keeps verification practical with the current Vitest + CLI smoke setup.

### Consequences
- Short-term duplication and shim layers are acceptable during migration.
- Build/test tooling becomes slightly more complex because the repo gains workspaces.
- Claude will become the reference adapter implementation that future adapters should emulate rather than special-casing core.

### Follow-ups
- After phases 1-4, define Gemini/Codex adapters against the same contract before adding more tool-specific features.
- Decide whether file logging remains sufficient or whether later phases need indexed storage/search.
- Revisit whether `arc health` should remain distinct from `arc doctor` once automation use cases are clearer.

## Follow-up Staffing Guidance

### Available agent types roster
- `planner`
- `architect`
- `critic`
- `executor`
- `debugger`
- `test-engineer`
- `verifier`
- `explore`
- `writer`
- `git-master`

### Recommended execution shape
**If using `ralph` (single-owner, sequential):**
- Owner: `executor` with high reasoning.
- Embedded review checkpoints: `architect` after phase 1 design extraction, `critic` after adapter contract draft, `test-engineer` before phase 3/4 verification lock-in, `verifier` at final handoff.
- Best for: one controlled migration branch with tight rollback discipline.

**If using `$team` / `omx team` (parallel):**
- Lane 1 — workspace/core extraction: `executor` (high) + `architect` (medium review checkpoint)
- Lane 2 — adapter contract + Claude adapter: `executor` (high) + `debugger` (medium for integration fallout)
- Lane 3 — logging + logs command: `executor` (medium) + `test-engineer` (medium)
- Lane 4 — lifecycle/health + final verification: `executor` (high) + `verifier` (high)
- Shared support: `explore` (low) for repo mapping and grep-based regression sweeps; `writer` (low) for migration notes if docs are requested.

### Concrete staffing / sequencing guidance
1. Run phase 1 mostly sequentially; package boundaries affect every downstream lane.
2. Start phase 2 only after phase 1 exports stabilize.
3. Run phases 3 and 4 in parallel once adapter/core seams are merged, because logging and lifecycle share core services but different command surfaces.
4. Reserve one final verifier lane for root build/test/manual smoke evidence across all phases.

### Launch hints
- Sequential path: `$ralph implement .omx/plans/prd-arc-phases-1-4.md with .omx/plans/test-spec-arc-phases-1-4.md as the verification contract`
- Team path: `$team implement ARC phases 1-4 using .omx/plans/prd-arc-phases-1-4.md and .omx/plans/test-spec-arc-phases-1-4.md; sequence phase 1 first, then split phases 2/3/4 by lane`
- OMX CLI-style hint: `omx team --plan .omx/plans/prd-arc-phases-1-4.md --test-spec .omx/plans/test-spec-arc-phases-1-4.md`

### Team verification path
- Gate A: root workspace build/typecheck/test passes after phase 1 before any parallelization.
- Gate B: adapter regression suite passes before logging/lifecycle lanes merge.
- Gate C: logs + health/shutdown integration tests pass and manual TUI/launch smoke checks are recorded.
- Gate D: final verifier confirms zero remaining Claude-specific branches in core/app layers except registry wiring.
