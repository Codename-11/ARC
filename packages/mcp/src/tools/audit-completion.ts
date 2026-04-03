import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { auditCompletion, writeLogEvent } from "@axiom-labs/arc-core";
import type { AgentResponse } from "@axiom-labs/arc-core";

/**
 * Register the arc_audit_completion tool on an MCP server.
 *
 * Delegates to core's auditCompletion() pure function.
 * Returns the full CompletionAudit: status, confidence, recommendation, checksPassed, checksFailed.
 */
export function registerAuditCompletion(server: McpServer): void {
  server.tool(
    "arc_audit_completion",
    "Audit an agent response for completion signals. Returns status (complete/partial/failed/uncertain), confidence score, recommendation, and checks passed/failed.",
    {
      response_content: z.string().describe("The agent's response content to audit"),
      tool_calls: z
        .string()
        .optional()
        .describe("Optional JSON-encoded array of tool calls made by the agent"),
    },
    async ({ response_content, tool_calls }) => {
      writeLogEvent({
        level: "info",
        component: "mcp:tool:audit_completion",
        message: `Auditing completion for response (${response_content.length} chars)`,
        data: { hasToolCalls: tool_calls !== undefined },
      });

      const agentResponse: AgentResponse = {
        content: response_content,
        toolCalls: tool_calls ? parseToolCalls(tool_calls) : undefined,
      };

      const result = auditCompletion(agentResponse);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}

/** Safely parse tool_calls JSON string, returning undefined on failure. */
function parseToolCalls(raw: string): unknown[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
