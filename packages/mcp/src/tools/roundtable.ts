/**
 * `arc_roundtable` MCP tool — run a non-streaming roundtable and return
 * { transcript, synthesis, consensusScore, keyPoints, durationMs }.
 *
 * See docs/plans/ai-and-roundtable.md — Phase 6.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RoundtableOrchestrator,
  loadConfig,
  writeLogEvent,
  type Profile,
  type RoundtableAgent,
  type RoundtableRole,
} from "@axiom-labs/arc-core";

const INPUT_SCHEMA = {
  topic: z.string().describe("Topic of the roundtable discussion"),
  agents: z
    .array(z.string())
    .min(2)
    .describe("ARC profile names to participate (minimum 2)"),
  rounds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Number of discussion rounds (default 2)"),
  synthesizer: z
    .string()
    .optional()
    .describe(
      "Profile that writes the final summary (must be one of `agents`; default: first agent)",
    ),
};

function defaultRole(i: number): RoundtableRole {
  if (i === 0) return "advocate";
  if (i === 1) return "critic";
  return "neutral";
}

/** Register the arc_roundtable tool on an MCP server. */
export function registerRoundtableTool(server: McpServer): void {
  server.tool(
    "arc_roundtable",
    "Run a multi-agent roundtable discussion across ARC profiles. Returns { transcript, synthesis, consensusScore, keyPoints, durationMs }.",
    INPUT_SCHEMA,
    async ({ topic, agents: agentNames, rounds, synthesizer: synthesizerName }) => {
      writeLogEvent({
        level: "info",
        component: "mcp:tool:arc_roundtable",
        message: `arc_roundtable invoked (agents=${agentNames.length}, rounds=${rounds ?? 2})`,
        data: { topic: topic.slice(0, 160), agents: agentNames, rounds },
      });

      const config = loadConfig();
      const agents: RoundtableAgent[] = [];
      for (let i = 0; i < agentNames.length; i++) {
        const name = agentNames[i];
        const profile: Profile | undefined = config.profiles[name];
        if (!profile) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `arc_roundtable: profile "${name}" not found.`,
              },
            ],
          };
        }
        if (!profile.tool) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `arc_roundtable: profile "${name}" has no tool set.`,
              },
            ],
          };
        }
        agents.push({
          profile,
          role: defaultRole(i),
          displayName: name,
        });
      }

      let synthesizer: RoundtableAgent = agents[0];
      if (synthesizerName) {
        const match = agents.find((a) => a.displayName === synthesizerName);
        if (!match) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `arc_roundtable: synthesizer "${synthesizerName}" must be one of the agents (${agentNames.join(", ")}).`,
              },
            ],
          };
        }
        synthesizer = match;
      }

      const orchestrator = new RoundtableOrchestrator({});
      try {
        const result = await orchestrator.run({
          topic,
          agents,
          rounds,
          synthesizer,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  transcript: result.transcript,
                  synthesis: result.synthesis,
                  consensusScore: result.consensusScore,
                  keyPoints: result.keyPoints,
                  durationMs: result.durationMs,
                  roundtableId: result.roundtableId,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `arc_roundtable: ${msg}` }],
        };
      }
    },
  );
}
