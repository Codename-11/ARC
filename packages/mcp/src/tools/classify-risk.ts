import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { classifyRisk, writeLogEvent } from "@axiom-labs/arc-core";

/**
 * Register the arc_classify_risk tool on an MCP server.
 *
 * Delegates to core's classifyRisk() pure function.
 * Returns the full RiskClassification: tier, reasons, requiresConfirmation, checklistIntensity.
 */
export function registerClassifyRisk(server: McpServer): void {
  server.tool(
    "arc_classify_risk",
    "Classify the risk tier of an agent action. Returns tier (read-only → destructive), reasons, whether confirmation is required, and checklist intensity.",
    { action: z.string().describe("The action string to classify") },
    async ({ action }) => {
      writeLogEvent({
        level: "info",
        component: "mcp:tool:classify_risk",
        message: `Classifying risk for action (${action.length} chars)`,
        data: { actionPreview: action.slice(0, 120) },
      });

      const result = classifyRisk(action);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
