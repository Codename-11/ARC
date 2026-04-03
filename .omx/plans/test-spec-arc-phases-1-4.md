# ARC Phases 1-4 — Expanded Test Spec

## Scope
Verification contract for:
1. Monorepo setup + core/profile migration
2. Adapter interface + Claude Code adapter
3. Logging framework + `arc logs`
4. Graceful shutdown + health checks

## Baseline commands
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`

## Test matrix

### 1. Workspace / monorepo migration
- Root workspace install succeeds and package graph resolves without manual path hacks.
- Root build emits the CLI entry point from the app package and preserves the `arc` bin.
- Root test/typecheck commands execute package-aware configs successfully.
- Existing E2E expectations are updated to the new build location without changing command semantics.

### 2. Core / profile extraction
- `loadConfig`, `saveConfig`, and `validateConfig` retain current semantics under package imports.
- Profile CRUD still works with temp `ARC_DIR` fixtures.
- Launch env assembly still sanitizes tool auth env vars before applying profile overrides.
- Doctor/status/profile commands all resolve shared core APIs rather than duplicate logic.

### 3. Adapter contract + Claude adapter
- Adapter registry resolves `claude` and falls back appropriately for default tool flows.
- Claude import still captures `.claude.json` from source dir or home fallback when applicable.
- Claude OAuth parsing still recognizes `.credentials.json` formats currently supported in `src/auth.ts`.
- Claude install hints and config detection still match current behavior.
- No remaining direct Claude branching in app/core command handlers beyond adapter registration.

### 4. Logging framework + `arc logs`
- Structured events are appended successfully under temp ARC data directories.
- Retention trimming works without corrupting the log file.
- `arc logs` default output is human-readable and exits 0 when logs exist.
- `arc logs --json` emits parseable records.
- Empty or malformed log files produce non-fatal warnings or empty output, not crashes.
- Launch/profile/doctor/shutdown events are all represented in the resulting log stream.

### 5. Graceful shutdown + health checks
- Shutdown handlers execute once even if multiple signals/exit paths fire.
- TUI teardown restores terminal state when quitting normally.
- Launch interruption path restores terminal state and exits with deterministic code handling.
- Health probes cover config validity, binary presence, credential readability, and logger readiness.
- Machine-readable health surface returns stable keys/statuses for automation.

## Suggested test additions by file area

### Integration
- `tests/integration/profile.test.ts`
  - Extend for package import path changes.
  - Add adapter-backed import and env-building assertions.
- New `tests/integration/adapter-claude.test.ts`
  - Cover detection, `.claude.json` fallback, credential parsing, env shaping.
- New `tests/integration/logging.test.ts`
  - Cover structured write/read/retention/error tolerance.
- New `tests/integration/health.test.ts`
  - Cover reusable probes independent of CLI formatting.
- New `tests/integration/lifecycle.test.ts`
  - Cover cleanup registration ordering and idempotence.

### E2E
- `tests/e2e/cli.test.ts`
  - Update root build path assumptions.
  - Add `arc logs` help/smoke cases.
  - Add health command or doctor JSON mode smoke case.
- `tests/e2e/tui.test.ts`
  - Add terminal cleanup assertions where feasible.
- `tests/e2e/tui-interactive.test.ts`
  - Add launch-from-TUI interruption / exit cleanliness scenarios.

## Manual smoke checklist
- [ ] `arc --help`
- [ ] `arc list` with empty ARC_DIR
- [ ] `arc profile create demo --auth-type oauth`
- [ ] `arc import` against Claude fixture/profile
- [ ] `arc launch demo -- --help` or equivalent harmless passthrough
- [ ] `arc doctor`
- [ ] `arc health` or `arc doctor --json` (final chosen UX)
- [ ] `arc logs --limit 10`
- [ ] Open TUI, quit, verify terminal state restored
- [ ] Open TUI, trigger launch path, verify handoff and cleanup

## Exit criteria
- All baseline commands pass at root.
- New integration suites for adapter/logging/lifecycle/health pass.
- E2E coverage passes against the new monorepo output paths.
- Manual smoke checklist is complete on at least one Windows environment and one POSIX environment, or explicit gap is documented.
