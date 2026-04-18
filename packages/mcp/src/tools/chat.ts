/**
 * `arc_chat` MCP tool — run a one-shot ARC agent query through an ARC profile.
 *
 * Defaults to `read-only` permission mode because external MCP callers cannot
 * interactively confirm writes. An explicit `mode: "autonomous"` is allowed
 * but logged to stderr as a warning.
 *
 * See docs/plans/ai-and-roundtable.md — Phase 6.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ToolRegistry,
  buildSystemPrompt,
  getAgentClientForProfile,
  getRecentLaunches,
  loadConfig,
  registerArcTools,
  resolveProfile,
  runAgent,
  writeLogEvent,
  type PermissionMode,
  type Profile,
  type ToolContext,
} from "@axiom-labs/arc-core";

const INPUT_SCHEMA = {
  prompt: z.string().describe("User prompt to send to the agent"),
  profile: z
    .string()
    .optional()
    .describe(
      "ARC profile name (defaults to the active profile in ~/.arc/config.json)",
    ),
  mode: z
    .enum(["read-only", "supervised", "autonomous"])
    .optional()
    .describe(
      "Permission mode (default read-only; MCP callers cannot confirm interactively)",
    ),
};

/**
 * Register the arc_chat tool on an MCP server.
 *
 * Wires an ARC profile's agent client + tool registry + runAgent into a
 * one-shot prompt→response tool. Collects all text chunks emitted by the
 * agent and returns them as a single text content block.
 */
export function registerChatTool(server: McpServer): void {
  server.tool(
    "arc_chat",
    "Send a one-shot prompt to an ARC profile's agent with full ARC tool use. Defaults to read-only permission mode.",
    INPUT_SCHEMA,
    async ({ prompt, profile: profileName, mode }) => {
      const chosenMode: PermissionMode = mode ?? "read-only";
      if (chosenMode === "autonomous") {
        process.stderr.write(
          "[arc-mcp] arc_chat: autonomous permission mode enabled by caller — writes will execute without human confirmation.\n",
        );
      }

      writeLogEvent({
        level: "info",
        component: "mcp:tool:arc_chat",
        message: `arc_chat invoked (mode=${chosenMode}, promptChars=${prompt.length})`,
        data: {
          mode: chosenMode,
          profile: profileName ?? "(active)",
          promptPreview: prompt.slice(0, 120),
        },
      });

      // ── Resolve profile ───────────────────────────────
      const config = loadConfig();
      const name = profileName ?? config.activeProfile ?? undefined;
      if (!name) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "arc_chat: no profile specified and no active profile set. Pass `profile` explicitly or set one with `arc profile switch <name>`.",
            },
          ],
        };
      }

      let profile: Profile;
      try {
        profile = resolveProfile(config, name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `arc_chat: ${msg}` }],
        };
      }
      if (!profile.tool) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `arc_chat: profile "${name}" has no tool set.`,
            },
          ],
        };
      }

      // ── Build client, registry, system prompt ─────────
      let client;
      try {
        client = getAgentClientForProfile(profile);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `arc_chat: ${msg}` }],
        };
      }

      const registry = new ToolRegistry();
      registerArcTools(registry);

      const recentLaunches = getRecentLaunches(3).map((l) => ({
        profile: l.profile,
        tool: l.tool,
        startedAt: l.timestamp,
        exitCode: l.exitCode,
      }));
      const systemPrompt = buildSystemPrompt({
        config,
        recentLaunches,
        activeProfile: profile,
        arcVersion: "mcp",
        doctorIssues: [],
        permissionMode: chosenMode,
        toolCategories: [
          "profiles (list, show)",
          "state (active profile, recent launches, doctor)",
          "logs + memory + tasks (read)",
          "skills + remote agents (read)",
        ],
      });

      // MCP callers can't interactively confirm — auto-deny writes unless
      // the caller explicitly requested autonomous mode.
      const ctx: ToolContext = {
        mode: chosenMode,
        confirm: async () => chosenMode === "autonomous",
        log: () => {},
        profile,
      };

      // ── Wrap client to inject system prompt ───────────
      const wrappedClient = {
        send(p: string) {
          return client.send(p, { instructions: systemPrompt });
        },
        shutdown() {
          return client.shutdown();
        },
      };

      // ── Run agent loop, collect text ──────────────────
      const textParts: string[] = [];
      let errorMessage: string | undefined;
      try {
        for await (const ev of runAgent(
          { client: wrappedClient, registry, ctx },
          prompt,
        )) {
          if (ev.type === "text") textParts.push(ev.content);
          else if (ev.type === "error") errorMessage = ev.message;
        }
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      } finally {
        try {
          await client.shutdown();
        } catch {
          /* ignore */
        }
      }

      const text = textParts.join("").trim() || "(no response)";
      if (errorMessage && textParts.length === 0) {
        return {
          isError: true,
          content: [{ type: "text", text: `arc_chat: ${errorMessage}` }],
        };
      }

      return {
        content: [{ type: "text", text }],
      };
    },
  );
}
