/**
 * Team tools registrar — 6-tool contract ported from Agent-Forge.
 *
 * Exposes: team_say, team_read, team_status, team_done, team_plan, team_ask.
 *
 * Session scope: all tools share a single in-memory bus per MCP server
 * process. See `shared-bus.ts` for the scope limitation.
 *
 * See docs/plans/ai-and-roundtable.md — Phase 6.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTeamSay } from "./say.js";
import { registerTeamRead } from "./read.js";
import { registerTeamStatus } from "./status.js";
import { registerTeamDone } from "./done.js";
import { registerTeamPlan } from "./plan.js";
import { registerTeamAsk } from "./ask.js";

export { teamBus, TeamSessionStore } from "./shared-bus.js";
export type { TeamAgentState, TeamAgentStatus, TeamMessageMeta } from "./shared-bus.js";

/**
 * Register all 6 team tools on an MCP server. Idempotent-at-module-level
 * (tools are keyed by name in the SDK; calling twice on the same server
 * throws — consumers should call once during server setup).
 */
export function registerTeamTools(server: McpServer): void {
  registerTeamSay(server);
  registerTeamRead(server);
  registerTeamStatus(server);
  registerTeamDone(server);
  registerTeamPlan(server);
  registerTeamAsk(server);
}
