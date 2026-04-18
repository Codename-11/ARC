/**
 * Permission gating helpers for the agent tool registry.
 *
 * The matrix:
 *
 * | mode        | read | write                  | dangerous              |
 * |-------------|------|------------------------|------------------------|
 * | read-only   | yes  | hidden                 | hidden                 |
 * | supervised  | yes  | yes (needs confirm)    | yes (needs confirm)    |
 * | autonomous  | yes  | yes (no confirm)       | yes (no confirm)       |
 */

import type { PermissionMode, Tool } from "./types.js";

/**
 * Whether a tool may be listed and invoked under the given mode.
 *
 * In `read-only` mode, only `read` tools are available. Other modes expose
 * everything — the separate `needsConfirmation` gate decides whether the
 * human must approve.
 */
export function canUseTool(tool: Tool, mode: PermissionMode): boolean {
  if (mode === "read-only") {
    return tool.permission === "read";
  }
  return true;
}

/**
 * Whether a handler call must be preceded by `ctx.confirm(...)`.
 *
 * Confirmation is only required in `supervised` mode for `write` or
 * `dangerous` tools. `read-only` never reaches write/dangerous tools; in
 * `autonomous` the operator has pre-authorized everything.
 */
export function needsConfirmation(tool: Tool, mode: PermissionMode): boolean {
  if (mode !== "supervised") return false;
  return tool.permission === "write" || tool.permission === "dangerous";
}
