/**
 * team_done — mark the current agent as done in a staged workflow.
 *
 * Phase 6 note: the MCP SDK doesn't surface a caller identity, so the agent
 * name is carried in the `summary` and the logical agent is "mcp". Callers
 * that need multi-agent differentiation should prefix the summary, e.g.
 * "agent=alice: implemented parser".
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeLogEvent } from "@axiom-labs/arc-core";
import { teamBus, type TeamMessageMeta } from "./shared-bus.js";

const INPUT_SCHEMA = {
  summary: z
    .string()
    .describe("Short summary of what was accomplished (one-line preferred)"),
  agent: z
    .string()
    .optional()
    .describe(
      "Agent name to mark done (default: 'mcp' — MCP callers may not have a dedicated identity)",
    ),
};

export function registerTeamDone(server: McpServer): void {
  server.tool(
    "team_done",
    "Mark the current agent as done in a staged workflow, posting a summary to the bus.",
    INPUT_SCHEMA,
    async ({ summary, agent }) => {
      const name = agent ?? "mcp";
      const meta: TeamMessageMeta = { tag: "done", priority: "normal" };
      const msg = await teamBus.post(summary, meta, name);
      const state = teamBus.setStatus(name, "done", summary);
      writeLogEvent({
        level: "info",
        component: "mcp:tool:team_done",
        message: `team_done: ${name}`,
        data: { id: msg.id, summary: summary.slice(0, 160) },
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, id: msg.id, agent: state }),
          },
        ],
      };
    },
  );
}
