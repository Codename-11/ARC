/**
 * team_status — list current agent statuses.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { teamBus } from "./shared-bus.js";

// No fields — empty schema object.
const INPUT_SCHEMA = {};

export function registerTeamStatus(server: McpServer): void {
  server.tool(
    "team_status",
    "Get the current status of all agents in the team session.",
    INPUT_SCHEMA,
    async () => {
      const agents = teamBus.listAgents();
      return {
        content: [
          { type: "text", text: JSON.stringify({ agents }) },
        ],
      };
    },
  );
}
