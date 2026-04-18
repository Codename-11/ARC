/**
 * team_ask — post a DM-priority question to a specific agent.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeLogEvent } from "@axiom-labs/arc-core";
import { teamBus, type TeamMessageMeta } from "./shared-bus.js";

const INPUT_SCHEMA = {
  to: z.string().describe("Target agent name (DM recipient)"),
  question: z.string().describe("Question to ask"),
  from: z
    .string()
    .optional()
    .describe("Agent name asking the question (default: 'mcp')"),
};

export function registerTeamAsk(server: McpServer): void {
  server.tool(
    "team_ask",
    "Ask a direct question of another team agent. Posts a DM-priority message.",
    INPUT_SCHEMA,
    async ({ to, question, from }) => {
      const sender = from ?? "mcp";
      const meta: TeamMessageMeta = {
        tag: "dm",
        priority: "urgent",
        to,
      };
      const msg = await teamBus.post(question, meta, sender);
      writeLogEvent({
        level: "info",
        component: "mcp:tool:team_ask",
        message: `team_ask ${sender} -> ${to}`,
        data: { id: msg.id, preview: question.slice(0, 160) },
      });
      return {
        content: [
          { type: "text", text: JSON.stringify({ ok: true, id: msg.id }) },
        ],
      };
    },
  );
}
