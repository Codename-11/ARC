# Test Spec — ARC phases 1-4

- **Task:** Verify delivery of ARC phases 1-4 (monorepo/core migration, Claude adapter, logging + `arc logs`, graceful shutdown + health checks).
- **Planning date:** 2026-04-03

## Test objectives
1. Preserve current CLI/profile behavior during the workspace migration.
2. Prove Claude adapter parity against the current import/detect/launch behavior.
3. Prove CLI and TUI both consume the same adapter-backed service layer for tool-specific behavior.
4. Prove structured logs are emitted and queryable via `arc logs`.
5. Prove shutdown/health behavior is explicit, stable, and machine-readable for the in-scope session paths (`launch`, `exec`, `shell`, TUI teardown, CLI boundary).

## Scope
### In scope
- Root workspace commands and package outputs.
- Profile CRUD/config/auth behavior.
- Claude detection/import/launch prep and diagnostics.
- `arc logs` and `arc health` CLI surfaces.
- Lifecycle manager behavior for CLI, shell, exec, launch, and TUI teardown.

### Out of scope
- Codex/Gemini adapter correctness beyond keeping existing profile tool strings intact.
- Later roadmap features (dashboard, telemetry, memory, tasks, sync, plugins).

## Test inventory

### A. Characterization tests (before or during refactor)
- Preserve existing `tests/e2e/cli.test.ts:55-123` coverage for help/version/list/doctor/profile/shared flows.
- Preserve existing `tests/integration/profile.test.ts:31-194` coverage for config/profile CRUD and malformed config handling.
- Add focused characterization tests around current Claude import edge cases:
  - source dir copying behavior
  - `.claude.json` fallback copy from source/home (`src/commands/profile.ts:316-333`)
  - OAuth/env handling from `src/auth.ts:168-280`

### B. Unit tests
- `packages/core` config repository, profile repository, path/shared-fs helpers, logging/lifecycle/health aggregation services.
- proof-oriented checks that `packages/core` contains no Claude-specific env/import/shared-layer rules.
- adapter contract helpers and Claude adapter implementations (including auth/env/import behavior).
- structured logger write/filter/retention logic.
- lifecycle manager cleanup registration and shutdown reason mapping.
- health aggregation status mapping and JSON serialization.

### C. Integration tests
- CLI commands import core services through package boundaries.
- CLI and TUI create/import/onboarding/doctor flows resolve through the same adapter-backed service layer.
- Claude adapter returns install hints, binary checks, launch env, import copy rules, and shared-layer Claude artifact handling equivalent to current behavior.
- `arc logs --limit N --json` returns parseable structured entries from a temp `ARC_DIR`.
- `arc health --json` returns deterministic status for:
  - missing config
  - no profiles
  - missing tool binary
  - configured profile with auth state
  - unreadable log/config dir (where testable)

### D. E2E tests
- Build bundled CLI from workspace root and verify `dist/index.js` or equivalent published CLI entry still works.
- `arc logs` happy path:
  - generate events via profile create / status / health
  - read them back with filters
- `arc health` happy + failure paths.
- In-scope lifecycle/shutdown behavior (`launch`/`exec`/`shell`/TUI/CLI boundary):
  - process exits with child exit code
  - Ctrl+C / SIGTERM path logs a shutdown event
  - no terminal corruption after TUI exit or launch handoff
  - broader admin-command exit normalization is explicitly out of scope for phases 1-4

### E. Manual smoke tests
1. `pnpm typecheck`
2. `pnpm build`
3. `pnpm test`
4. `node dist/index.js --help`
5. `node dist/index.js health --json`
6. `node dist/index.js logs --limit 10 --json`
7. open TUI, quit, reopen, and perform a launch handoff

## Acceptance mapping
- **AC1 Workspace migration:** root build/typecheck/test pass; published CLI still resolves.
- **AC2 Core migration:** unit/integration checks prove generic services moved into core and core contains no Claude-specific env/import/shared-layer logic.
- **AC3 Claude adapter parity:** adapter integration tests cover detection/import/launch prep/auth diagnostics/shared artifacts.
- **AC4 CLI/TUI unification:** integration or targeted presenter tests prove both surfaces consume the same adapter-backed service layer.
- **AC5 Logging:** unit + integration + E2E prove structured event emission and `arc logs` filtering.
- **AC6 Shutdown:** E2E/manual tests prove signal handling, child exit normalization, and terminal restoration for the in-scope session paths only.
- **AC7 Health:** integration/E2E prove `arc health` output in human and JSON forms.
- **AC8 Verification:** full root test/build pipeline plus manual smoke evidence captured.

## Observability proof requirements
- Capture sample NDJSON log lines showing:
  - profile mutation
  - launch attempt / success / failure
  - health run
  - shutdown event
- Capture CLI JSON output samples for `arc logs` and `arc health`.
- Record any known gaps in shutdown signal simulation if cross-platform automation is flaky.

## Exit criteria
- All blocking tests pass.
- Any deferred or flaky checks are explicitly documented with rationale.
- The verifier can trace every new user-facing capability (`arc logs`, `arc health`, shutdown handling) to at least one automated or manual proof artifact.
