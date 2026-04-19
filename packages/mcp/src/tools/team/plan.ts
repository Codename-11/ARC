/**
 * team_plan — post a plan message tagged as such.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeLogEvent } from "@axiom-labs/arc-core";
import { teamBus, type TeamMessageMeta } from "./shared-bus.js";

const INPUT_SCHEMA = {
  plan: z.string().describe("The plan content to share with the team"),
  agent: z
    .string()
    .optional()
    .describe("Agent name posting the plan (default: 'mcp')"),
};

export function registerTeamPlan(server: McpServer): void {
  server.tool(
    "team_plan",
    "Post a plan message to the team bus, tagged as a plan so coordinators can filter it.",
    INPUT_SCHEMA,
    async ({ plan, agent }) => {
      const name = agent ?? "mcp";
      const meta: TeamMessageMeta = { tag: "plan", priority: "normal" };
      const msg = await teamBus.post(plan, meta, name);
      writeLogEvent({
        level: "info",
        component: "mcp:tool:team_plan",
        message: `team_plan posted (len=${plan.length})`,
        data: { id: msg.id, agent: name },
      });
      return {
        content: [
          { type: "text", text: JSON.stringify({ ok: true, id: msg.id }) },
        ],
      };
    },
  );
}
