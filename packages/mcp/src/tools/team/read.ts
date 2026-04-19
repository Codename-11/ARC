/**
 * team_read — cursor-based read of the team bus.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { teamBus } from "./shared-bus.js";

const INPUT_SCHEMA = {
  cursor: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Cursor returned by a previous read (default 0 = from start)"),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Max messages to return (default 50)"),
};

export function registerTeamRead(server: McpServer): void {
  server.tool(
    "team_read",
    "Read new team-bus messages since a cursor. Returns { messages, cursor }.",
    INPUT_SCHEMA,
    async ({ cursor, limit }) => {
      const cap = Math.max(1, Math.min(limit ?? 50, 500));
      const res = await teamBus.read(cursor ?? 0);
      const messages = res.messages.slice(0, cap);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              messages,
              cursor: res.cursor,
              truncated: res.messages.length > cap,
            }),
          },
        ],
      };
    },
  );
}
