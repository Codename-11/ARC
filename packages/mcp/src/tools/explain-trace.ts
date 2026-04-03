import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { queryLogEvents, writeLogEvent } from "@axiom-labs/arc-core";
import type { LogEvent } from "@axiom-labs/arc-core";

/**
 * Format a single log event into a human-readable line.
 */
function formatEvent(event: LogEvent): string {
  const ts = event.timestamp;
  const level = event.level.toUpperCase().padEnd(5);
  const component = event.component;
  const action = event.action;
  const message = event.message ?? "";
  const detail = event.detail && event.detail !== message ? ` | ${event.detail}` : "";
  return `[${ts}] ${level} ${component}::${action} ${message}${detail}`;
}

/**
 * Build a structured trace explanation from log events.
 */
function buildTraceExplanation(events: LogEvent[], filters: { sessionId?: string; component?: string }): object {
  if (events.length === 0) {
    return {
      status: "empty",
      message: "No log events found matching the query.",
      filters,
      eventCount: 0,
      trace: [],
    };
  }

  // Group events by component for overview
  const byComponent = new Map<string, number>();
  const byLevel = new Map<string, number>();

  for (const ev of events) {
    byComponent.set(ev.component, (byComponent.get(ev.component) ?? 0) + 1);
    byLevel.set(ev.level, (byLevel.get(ev.level) ?? 0) + 1);
  }

  const first = events[0];
  const last = events[events.length - 1];

  return {
    status: "ok",
    eventCount: events.length,
    timeRange: {
      from: first.timestamp,
      to: last.timestamp,
    },
    filters,
    breakdown: {
      byComponent: Object.fromEntries(byComponent),
      byLevel: Object.fromEntries(byLevel),
    },
    trace: events.map(formatEvent),
  };
}

/**
 * Register the arc_explain_trace tool on an MCP server.
 *
 * Queries ARC's structured log and formats entries into a human-readable
 * trace explanation. Supports filtering by component and limiting result count.
 */
export function registerExplainTrace(server: McpServer): void {
  server.tool(
    "arc_explain_trace",
    "Query and explain ARC's structured activity log. Returns formatted trace with event breakdown by component and level. Useful for debugging agent behavior and supervision decisions.",
    {
      session_id: z
        .string()
        .optional()
        .describe("Filter to a specific session (matched against profile field). Omit for all sessions."),
      component: z
        .string()
        .optional()
        .describe("Filter to a specific component (e.g. 'mcp', 'hooks', 'risk-classifier'). Omit for all components."),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of log events to return. Defaults to 50."),
    },
    async ({ session_id, component, limit }) => {
      const effectiveLimit = limit ?? 50;

      writeLogEvent({
        level: "info",
        component: "mcp:tool:explain_trace",
        message: `Querying trace log (limit=${effectiveLimit}, component=${component ?? "all"}, session=${session_id ?? "all"})`,
      });

      const events = queryLogEvents({
        limit: effectiveLimit,
        component: component ?? undefined,
        profile: session_id ?? undefined,
      });

      const explanation = buildTraceExplanation(events, {
        sessionId: session_id,
        component,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(explanation, null, 2) }],
      };
    },
  );
}
