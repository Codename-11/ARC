/**
 * team_say — post a plain message to the team bus.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeLogEvent } from "@axiom-labs/arc-core";
import { teamBus, type TeamMessageMeta } from "./shared-bus.js";

const INPUT_SCHEMA = {
  text: z.string().describe("Message text to post to the team bus"),
  to: z
    .string()
    .optional()
    .describe("Optional recipient agent name (for routed messages)"),
  priority: z
    .enum(["urgent", "normal", "low"])
    .optional()
    .describe("Delivery priority (default normal)"),
};

export function registerTeamSay(server: McpServer): void {
  server.tool(
    "team_say",
    "Post a message to the team bus so other agents can read it. Session-scoped (single MCP process).",
    INPUT_SCHEMA,
    async ({ text, to, priority }) => {
      const meta: TeamMessageMeta = {
        tag: "say",
        priority: priority ?? "normal",
        to,
      };
      const msg = await teamBus.post(text, meta);
      writeLogEvent({
        level: "info",
        component: "mcp:tool:team_say",
        message: `team_say posted (len=${text.length}, priority=${meta.priority}, to=${to ?? "all"})`,
        data: { id: msg.id },
      });
      return {
        content: [
          { type: "text", text: JSON.stringify({ ok: true, id: msg.id }) },
        ],
      };
    },
  );
}
