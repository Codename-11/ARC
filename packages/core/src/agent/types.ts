/**
 * Agent tool-use types — Phase 2 (tool registry + agent loop).
 *
 * These are the core primitives for the generic tool-use infrastructure that
 * lets an agent (driven by `AgentClient` from Phase 1) call ARC functionality
 * through a permission-gated registry.
 *
 * See `docs/plans/ai-and-roundtable.md` — AD-2, AD-3.
 */

import type { z } from "zod";
import type { Profile } from "../types.js";
import type { AgentClient } from "../agent-client/index.js";

// ---------------------------------------------------------------------------
// Permission model
// ---------------------------------------------------------------------------

/**
 * Permission mode controlling which tools an agent may invoke and whether a
 * human-in-the-loop confirmation is required before write/dangerous calls.
 *
 * - `read-only`   — only `read` tools are exposed to the model.
 * - `supervised`  — all tools exposed; `write` and `dangerous` require
 *                   confirmation via `ToolContext.confirm`.
 * - `autonomous`  — all tools exposed; no confirmation prompts. Every action
 *                   is still logged.
 */
export type PermissionMode = "read-only" | "supervised" | "autonomous";

/**
 * Permission tier a tool requires.
 *
 * - `read`       — side-effect-free inspection of local state.
 * - `write`      — mutates ARC config or local state; reversible.
 * - `dangerous`  — destructive or otherwise high-risk operation.
 */
export type ToolPermission = "read" | "write" | "dangerous";

// ---------------------------------------------------------------------------
// Tool context
// ---------------------------------------------------------------------------

/**
 * Runtime context passed to every tool handler. Wraps permission mode,
 * user-confirmation callback, structured logger, and (optional) active profile.
 */
export interface ToolContext {
  mode: PermissionMode;
  /**
   * Prompt the human for confirmation. Returns `true` to proceed, `false` to
   * block. Tool handlers should *not* call this directly — the registry calls
   * it before dispatching to the handler when the permission tier + mode
   * demand it. Handlers may still use it ad-hoc for multi-step confirmations.
   */
  confirm: (prompt: string) => Promise<boolean>;
  /** Structured info-level log sink. Non-throwing. */
  log: (msg: string) => void;
  /** Active profile, when the caller has resolved one. May be absent. */
  profile?: Profile;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

/**
 * A registered tool. `Input` is validated against `schema` before the handler
 * is called. `Output` is opaque to the registry — handlers may return any JSON
 * value.
 */
export interface Tool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  permission: ToolPermission;
  schema: z.ZodSchema<Input>;
  handler: (input: Input, ctx: ToolContext) => Promise<Output>;
}

/**
 * Public form of a tool sent to LLMs (no handler, no zod object — just
 * name + description + a JSON-Schema-ish shape the model can reason about).
 *
 * We intentionally keep `inputSchema` shape-agnostic (`Record<string, unknown>`)
 * so that callers can use `zod-to-json-schema` or any other converter without
 * this module taking on that dependency.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  permission: ToolPermission;
  inputSchema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tool result
// ---------------------------------------------------------------------------

/**
 * Result of executing a tool via the registry.
 *
 * `blocked: true` indicates the tool was refused (permission gate or
 * confirmation declined) — distinct from a handler-thrown error.
 */
export type ToolResult =
  | { ok: true; output: unknown }
  | { ok: false; error: string; blocked?: boolean };

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

/**
 * Events emitted by `runAgent` as it observes an agent session.
 */
export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_call"; id: string; tool: string; input: unknown }
  | { type: "tool_result"; id: string; tool: string; result: ToolResult }
  | { type: "error"; message: string }
  | { type: "done"; reason: "end_turn" | "max_turns" | "stop" | "error" };

/**
 * Forward declaration — avoids a circular type import. The concrete
 * `ToolRegistry` class lives in `./registry.ts`.
 */
export interface ToolRegistryLike {
  execute(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult>;
  has(name: string): boolean;
}

export interface AgentLoopOptions {
  client: AgentClient;
  registry: ToolRegistryLike;
  ctx: ToolContext;
  /** Safety cap on number of tool-call cycles. Default: 10. */
  maxTurns?: number;
}
