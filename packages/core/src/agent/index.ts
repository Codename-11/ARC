/**
 * Agent tool-use public surface (Phase 2).
 *
 * See `docs/plans/ai-and-roundtable.md` — AD-2, AD-3.
 */

export type {
  PermissionMode,
  ToolPermission,
  ToolContext,
  Tool,
  ToolDefinition,
  ToolResult,
  AgentEvent,
  AgentLoopOptions,
  ToolRegistryLike,
} from "./types.js";

export { canUseTool, needsConfirmation } from "./permissions.js";

export { ToolRegistry } from "./registry.js";

export { runAgent } from "./loop.js";

export { registerArcTools, ARC_TOOLS } from "./arc-tools.js";
