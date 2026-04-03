# RALPLAN Draft — ARC phases 1-4

## Requirements Summary

Build the first four ARC implementation phases defined by the Vault ARC brief (`C:\Users\Bailey\SynologyDrive\-Vault-\Axiom-Vault\3. System\Projects\ARC\ARC.md`):
1. Monorepo setup and migration of current core/profile logic.
2. Runtime adapter interface plus a production Claude Code adapter.
3. Structured logging plus an `arc logs` command.
4. Graceful shutdown and explicit health checks.

The current repository is a single TypeScript package with a Commander entrypoint (`src/cli.ts:6-220`), a root CLI bootstrap (`src/index.ts:1-9`), centralized config/profile types (`src/config.ts:9-98`, `src/types.ts:1-42`), tool-specific auth/env handling (`src/auth.ts:168-280`), direct tool detection (`src/detect.ts:11-58`), Claude-specific import logic (`src/commands/profile.ts:316-333`), direct launch execution (`src/commands/launch.ts:31-127`), a minimal activity logger (`src/log.ts:1-31`), TUI-only terminal restoration (`src/tui/render.tsx:7-90`), and diagnostics in `src/commands/doctor.ts:27-257`.

## RALPLAN-DR Summary

### Principles
1. **Preserve shipped behavior while changing seams** — ARC must keep current CLI/TUI profile flows working while the architecture is re-homed behind stable package boundaries.
2. **Isolate tool-specific behavior behind adapters** — Claude quirks should move out of generic command modules and into a runtime adapter contract.
3. **Adopt platform-safe infrastructure early** — logging, shutdown, and health must be designed to support later phases instead of becoming throwaway stopgaps.
4. **Prefer additive migration over big-bang rewrites** — introduce packages, registries, and lifecycle primitives with compatibility wrappers until the root CLI can flip cleanly.
5. **Verify cross-platform paths and terminal behavior continuously** — Windows-oriented launch/setup behavior is already embedded in the codebase and must remain first-class.

### Decision Drivers
1. **Current coupling is the main blocker** — profile, auth, detection, and launch logic are spread across command modules rather than reusable runtime boundaries (`src/auth.ts:168-280`, `src/commands/profile.ts:316-333`, `src/commands/launch.ts:31-127`).
2. **Phases 3-4 depend on phase-2 seams** — structured logs, health, and lifecycle coordination become much easier once launch/diagnostics route through a runtime abstraction.
3. **The repo already ships tests and a public package** — migration risk must stay bounded so the existing build/test/publish path keeps working (`package.json`, `tests/e2e/cli.test.ts`, `tests/integration/profile.test.ts`).

### Viable Options

#### Option A — Big-bang monorepo split before feature work
**Approach:** Create all target packages up front and fully move CLI, core, runtime, and Claude code before implementing logs/health.

**Pros**
- Cleanest package boundaries from day one.
- Minimizes temporary compatibility wrappers.
- Forces adapter contracts to stabilize early.

**Cons**
- Highest regression risk for a public CLI.
- Harder to localize failures when build, imports, and runtime semantics shift simultaneously.
- Makes phases 3-4 dependent on a large structural merge.

#### Option B — Strangler monorepo migration with compatibility facade (**recommended**)
**Approach:** Establish workspace packages first, then move config/profile/runtime code behind package exports while keeping the current `arc` CLI entry and command surface stable; phase-2 adapter routing lands before phases 3-4 consume it.

**Pros**
- Aligns with the explicit phase ordering without forcing one massive cutover.
- Lets existing command modules delegate into new packages incrementally.
- Keeps tests runnable after each migration slice.
- Creates clean seams for logs, health, and shutdown to reuse immediately.

**Cons**
- Temporary duplication/wrappers during migration.
- Requires discipline to remove compatibility shims after each slice.
- Workspace/build config becomes slightly more complex in the short term.

#### Option C — Stay single-package and introduce internal folders only
**Approach:** Add adapter/logging/lifecycle modules inside `src/` and defer actual monorepo/workspace extraction until later.

**Pros**
- Lowest initial churn.
- Fastest path to new features if phase 1 were optional.

**Cons**
- Undercuts the requested phase-1 deliverable.
- Makes future adapter packages harder to extract.
- Encourages current command-level coupling to persist.

### Recommendation
Choose **Option B**. It satisfies the required phase ordering, preserves existing CLI/TUI behavior, and creates the runtime seams that phases 3-4 need without forcing a single risky migration.

## Assumptions and Unknowns

### Assumptions
- The available Vault brief is authoritative for phases 1-4, and later phases (SQLite, dashboard, OpenTelemetry) remain out of scope for this execution pass.
- `pnpm` remains the workspace/package manager because the repo already declares `packageManager: pnpm@10.29.3` in `package.json`.
- The first adapter contract only needs to fully support Claude flows, but it should be generic enough for Codex/Gemini follow-on work.
- Phase-3 logging can start with versioned file-backed structured logs; SQLite log storage is deferred to later observability phases.

### Unknowns
- The `DECISIONS.md` / `SPEC.md` referenced by the Vault brief were not found in the repo or brief directory during this planning pass.
- The exact final monorepo package naming convention is unspecified; this draft proposes a concrete layout below.
- The expected output surface for health checks is unspecified; this draft assumes a new `arc health` command plus reusable runtime health probes.

## Acceptance Criteria

1. **Workspace foundation**
   - Root repo builds and tests through a workspace-aware setup (`pnpm install`, `pnpm build`, `pnpm test`, `pnpm typecheck`).
   - The repo defines package boundaries for at least: CLI app, core/profile domain, runtime host/lifecycle, and Claude adapter.
   - The published CLI entry still resolves to `arc` and remains backed by the root/bin package.

2. **Core/profile migration**
   - Current config/profile/auth/detection/path primitives now live behind package exports instead of root-level direct imports (`src/config.ts`, `src/types.ts`, `src/auth.ts`, `src/detect.ts`, `src/paths.ts`).
   - Existing profile CRUD/import/status/launch behavior remains functionally equivalent under the new package boundaries.

3. **Adapter interface + Claude adapter**
   - A runtime adapter contract exists and covers detection/import, credential status, environment preparation, launch metadata, and health probes.
   - Claude-specific logic, including `.claude.json` import handling, is owned by the Claude adapter rather than generic command modules (`src/commands/profile.ts:316-333`).
   - `arc launch`, onboarding/import, and diagnostics route Claude behavior through the adapter registry rather than hard-coded `tool === "claude"` branches.

4. **Logging framework + `arc logs`**
   - A structured logger replaces the append-only activity helper in `src/log.ts:1-31`.
   - `arc logs` is registered in the CLI and can print recent entries, filter by level/component, and emit machine-readable JSON.
   - Launch/profile/diagnostic flows emit structured log records with timestamps, component names, and event types.

5. **Graceful shutdown + health checks**
   - CLI and TUI runtime paths share a lifecycle/shutdown coordinator instead of ad-hoc `process.exit(...)` usage only.
   - Signal handling covers at least `SIGINT` and `SIGTERM`, restores terminal state, and cleans up tracked child processes.
   - A dedicated health surface reports ARC config/runtime/tool readiness (for example via `arc health` or equivalent command) using reusable probes rather than only the current doctor output.

6. **Verification**
   - Unit/integration/e2e coverage exists for workspace migration seams, adapter routing, structured logs, lifecycle cleanup, and health checks.
   - Existing core CLI/profile test suites still pass after the migration.

## Proposed Package Layout

- `apps/arc-cli/` — Commander entrypoint, command registration, TUI composition, human-facing command renderers.
- `packages/core/` — config schema, paths, profile models, shared utilities, version/config persistence.
- `packages/runtime/` — adapter interfaces/registry, launch orchestration, logging, shutdown lifecycle, health probe registry.
- `packages/adapters/claude/` — Claude detection, import/copy rules, env shaping, credential inspection, health probes, launch hints.
- `tests/` — retained at root initially, then re-pointed to workspace package entrypoints.

## Implementation Steps

1. **Phase 1 — Workspace bootstrap and package extraction**
   - Add workspace config at the repo root (`package.json`, new `pnpm-workspace.yaml`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`).
   - Create `apps/arc-cli`, `packages/core`, `packages/runtime`, and `packages/adapters/claude` packages.
   - Move/rehydrate config, types, paths, and reusable profile/domain logic from `src/config.ts:9-98`, `src/types.ts:1-42`, `src/paths.ts:1-43`, `src/detect.ts:11-58`, and the profile/auth helpers into package-owned modules.
   - Keep the root `arc` entry working by making `src/index.ts:1-9` / `src/cli.ts:6-220` delegate to the new CLI package or by moving the bin entry to `apps/arc-cli` with a compatibility export.

2. **Phase 1 completion — profile/core migration pass**
   - Refactor `src/commands/profile.ts`, `src/commands/status.ts`, `src/commands/onboarding.ts`, `src/tui/createProfile.ts`, and `src/tui/useProfiles.ts` to consume package exports instead of root-local one-off helpers.
   - Preserve current config shape and profile semantics while reducing direct cross-module coupling.
   - Update integration tests (`tests/integration/profile.test.ts`, `tests/integration/shared-layer.test.ts`) to exercise the package-backed implementations.

3. **Phase 2 — Adapter contract and Claude adapter**
   - Define `RuntimeAdapter` / `AdapterRegistry` contracts inside `packages/runtime` for detection, import support, credential status, env preparation, launch metadata, and health checks.
   - Move Claude-specific behavior from `src/auth.ts:168-280`, `src/detect.ts:11-58`, `src/commands/profile.ts:316-333`, `src/commands/launch.ts:17-127`, and any Claude shell-integration assumptions into `packages/adapters/claude`.
   - Replace generic command branches with adapter lookups in launch/import/onboarding/doctor/status flows.
   - Ensure the contract leaves room for future Codex/Gemini adapters without forcing phases 5+ implementation now.

4. **Phase 3 — Structured logging and `arc logs`**
   - Replace `src/log.ts:1-31` with a versioned structured logger in `packages/runtime` (for example NDJSON records under `~/.arc/logs/`).
   - Add `arc logs` command wiring in the CLI (`src/cli.ts:166-220` currently has room near lifecycle/status commands) and a renderer/formatter in the CLI app.
   - Instrument adapter launches, profile mutations, diagnostics, and health/lifecycle events with structured log metadata.
   - Add retention/rotation policy that keeps log growth bounded without losing recent runtime history.

5. **Phase 4 — Lifecycle manager, graceful shutdown, and health**
   - Introduce a runtime lifecycle coordinator in `packages/runtime` to own signal subscriptions, cleanup registration, child-process tracking, and terminal restoration.
   - Refactor `src/commands/launch.ts:31-127`, `src/commands/exec.ts`, `src/commands/shell.ts`, `src/index.ts:1-9`, and `src/tui/render.tsx:7-90` to use the shared lifecycle APIs instead of scattered `process.exit(...)` calls.
   - Add a health probe registry and expose it through a new `arc health` command plus shared diagnostics integration with `src/commands/doctor.ts:27-257`.
   - Verify the lifecycle manager handles both normal CLI exits and TUI-to-child-process handoffs without leaving the terminal corrupted.

6. **Stabilization pass**
   - Remove temporary compatibility wrappers created during migration.
   - Refresh docs/help text (`README.md`, `docs/*`, command help output) only for the new logging/health surfaces introduced by phases 3-4.
   - Run full verification and freeze the workspace layout before starting phases 5+.

## Risks and Mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Workspace migration breaks build/bin packaging | ARC currently ships as one package with a single `bin` entry in `package.json`; a bad split can break install/publish. | Keep `arc` entry stable during migration, add workspace-aware build smoke tests, and validate the built CLI via existing E2E harness before merging. |
| Adapter contract misses real Claude needs | Claude currently has bespoke import/auth/env logic spread across multiple modules. | Derive the contract directly from current flows (detect, import, env, credential status, launch, health) and move Claude code first before generalizing further. |
| Logging schema becomes a dead end | Later phases add dashboard, OTLP, and traces; a weak schema will force rework. | Use versioned structured records with component/event IDs and a human renderer layered on top rather than embedding presentation into the storage format. |
| Shutdown changes regress Windows or terminal safety | Existing TUI cleanup is delicate and explicitly prevents shell corruption. | Centralize cleanup registration, preserve `render.tsx` safeguards during refactor, and add Windows-aware signal/child tests plus manual terminal verification. |
| Health command duplicates doctor incoherently | Diagnostics already exist in `arc doctor`; adding another surface can confuse users. | Define reusable probes in runtime, let `doctor` and `health` share them, and differentiate deep diagnostics (`doctor`) from fast readiness (`health`). |
| Missing full spec hides a later constraint | The brief references other docs not currently available. | Record assumptions explicitly in the PRD and require a quick execution-time validation pass before code changes begin. |

## Verification Steps

1. `pnpm install` succeeds in workspace mode.
2. `pnpm typecheck` passes across all packages and the CLI app.
3. `pnpm build` produces a working `arc` executable/bundle.
4. `pnpm test` passes existing and new unit/integration/e2e suites.
5. E2E smoke checks cover at least:
   - `arc --help`
   - `arc list`
   - `arc doctor`
   - `arc logs --help`
   - `arc health --help` or `arc health --json`
6. Manual verification confirms:
   - Launching a Claude-backed profile still works.
   - TUI quit and TUI-to-launch handoff restore the terminal cleanly.
   - Structured logs are readable in both human and JSON modes.
   - Health output reports expected readiness failures/successes.

## Pre-mortem (Deliberate Mode)

1. **Failure scenario: the monorepo lands but the published CLI breaks.**
   - Trigger: bin path or build outputs move unexpectedly during the package split.
   - Early warning: `tests/e2e/cli.test.ts` or a fresh install smoke test can no longer find `dist/index.js` / `arc`.
   - Prevention: keep a compatibility CLI package and test the packaged artifact after each migration slice.

2. **Failure scenario: the Claude adapter contract is too thin and command modules keep special-casing Claude.**
   - Trigger: import, env, or health requirements do not fit the adapter surface.
   - Early warning: new `if (tool === "claude")` branches reappear in CLI commands after the adapter lands.
   - Prevention: define the contract from actual current code paths, review it architecturally before execution, and treat new command-level Claude branching as a regression.

3. **Failure scenario: lifecycle work fixes one exit path but leaves orphaned processes or terminal corruption in another.**
   - Trigger: signal handling and TUI cleanup evolve independently.
   - Early warning: manual quit/launch tests or CI subprocess tests intermittently hang or leave the terminal in raw mode.
   - Prevention: centralize cleanup registration, test signal paths, and keep terminal restoration logic idempotent.

## Expanded Test Plan

### Unit
- Config/profile package tests for migrated schema and persistence (`src/config.ts:9-98` equivalents).
- Adapter contract tests covering Claude detection, import mapping, env preparation, credential status, and health probe results.
- Logger tests for record schema, rotation/retention, filtering, and JSON rendering.
- Lifecycle tests for cleanup registration ordering, signal routing, and child tracking.

### Integration
- Profile CRUD/import/status flows against the new package exports.
- Adapter-registry-backed launch/import/doctor flows using temp ARC directories.
- `arc logs` output tests against fixture log files.
- `arc health` integration tests with mocked binaries/config/auth states.

### E2E
- Existing CLI/TUI smoke coverage preserved.
- New command smoke tests for `logs` and `health`.
- Launch-path verification that adapter routing still launches Claude with profile env.
- Cross-platform exit/handoff tests for dashboard quit and dashboard->launch behavior.

### Observability
- Assert every launch/profile/health/shutdown event writes structured log entries with level/component/event metadata.
- Verify failures (missing binary, bad config, signal interruption) are represented in logs.
- Add a regression check that `arc logs --json` can be parsed as valid NDJSON/JSON output.

## ADR

### Decision
Adopt a **strangler-style monorepo migration** that introduces workspace packages for core, runtime, and the Claude adapter while keeping the existing CLI entry stable; then implement structured logging and lifecycle/health on top of the new runtime seams.

### Drivers
- Current tool-specific logic is embedded in generic command modules.
- Phases 3-4 need a runtime seam to avoid duplicating launch/diagnostic/shutdown logic.
- The repo already ships a public CLI and tests, so migration risk must remain incremental.

### Alternatives Considered
- **Big-bang split first:** rejected for regression risk and difficult debugging.
- **Stay single-package:** rejected because it does not satisfy phase 1 and would perpetuate coupling.

### Why Chosen
This path satisfies the requested phase order, minimizes user-facing regressions, and sets up clean extension points for later Codex/Gemini adapters, richer observability, and runtime orchestration.

### Consequences
- Short-term compatibility wrappers and temporary dual-import paths are acceptable.
- Execution should remove old wrappers as soon as each migrated seam is stable.
- The first execution milestone should prove workspace/build/publish stability before proceeding deeper into runtime features.

### Follow-ups
- Validate assumptions against any newly located `DECISIONS.md` / `SPEC.md` before implementation starts.
- Freeze the adapter contract after Claude lands so phases 5-6 can reuse it directly.
- Revisit storage backends (SQLite/OTLP) only when later observability phases begin.

## Available-Agent-Types Roster

Recommended available roles for follow-up execution in this repo:
- `architect` — package boundaries, adapter/lifecycle contracts, migration sequencing.
- `executor` — code migration and feature implementation.
- `debugger` — signal/process regressions, launch-path failures, Windows quirks.
- `test-engineer` — workspace/test migration, new health/logging/lifecycle coverage.
- `verifier` — completion evidence, command smoke tests, artifact validation.
- `code-reviewer` / `critic` — late design and integration review.
- `writer` — documentation/help/changelog updates for new commands and workspace structure.
- `explore` — fast repository lookups during execution.

## Follow-up Staffing Guidance

### Ralph path (sequential, lower coordination overhead)
Use when one lead agent should drive the migration end-to-end while verifying after each slice.

Suggested lanes:
1. **Architecture lane** — `architect` / high reasoning
   - Finalize package boundaries, adapter contract, logger schema, lifecycle APIs.
2. **Implementation lane** — `executor` / high reasoning
   - Perform workspace migration, adapter extraction, logging, and lifecycle work in sequence.
3. **Regression lane** — `test-engineer` / medium reasoning
   - Add/repair unit, integration, and e2e coverage after each phase slice.
4. **Final proof lane** — `verifier` / high reasoning
   - Run typecheck/build/test/command-smoke/manual evidence review before closing.

Launch hint:
- `$ralph "Execute .omx/plans/prd-arc-phases-1-4-20260403T022251Z.md with .omx/plans/test-spec-arc-phases-1-4-20260403T022251Z.md; keep bin compatibility and verify after each phase."`

### Team path (parallel, faster if coordination is worth it)
Use when you want package extraction, runtime infrastructure, and tests/docs to advance in parallel after the architecture slice is frozen.

Suggested staffing:
- 1 × `architect` / high — owns package map, adapter and lifecycle contracts, review gates.
- 2 × `executor` / high —
  - Lane A: workspace/core/profile migration.
  - Lane B: runtime adapter/logging/lifecycle scaffolding.
- 1 × `test-engineer` / medium — updates harnesses, adds logs/health/shutdown coverage.
- 1 × `verifier` / high — runs proof suite, validates CLI behavior, audits command outputs.
- Optional 1 × `writer` / medium — README/docs/help text once code stabilizes.

Launch hints:
- `$team "Execute .omx/plans/prd-arc-phases-1-4-20260403T022251Z.md and .omx/plans/test-spec-arc-phases-1-4-20260403T022251Z.md. Staff lanes for workspace/core migration, runtime adapter+logging+lifecycle, tests, and final verification."`
- `omx team run --plan .omx/plans/prd-arc-phases-1-4-20260403T022251Z.md --test-spec .omx/plans/test-spec-arc-phases-1-4-20260403T022251Z.md`

## Team Verification Path

Before a team or Ralph execution shuts down, it should prove:
1. Workspace install/build/typecheck/test all pass from the root.
2. Existing profile CRUD/import/launch/status/doctor behavior still passes regression coverage.
3. `arc logs` and `arc health` are registered, documented, and validated in smoke tests.
4. Claude launch/import/credential paths run through the adapter registry without command-level special casing.
5. Signal/TUI shutdown tests and a manual terminal-restoration check both pass.
6. Final verifier confirms no remaining direct dependencies on deprecated root-only seams where the new packages should own them.

## Changelog of Applied Improvements
- Initial draft created from available repo evidence and the Vault phase brief.