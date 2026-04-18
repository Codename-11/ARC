/**
 * Agent program registry — ported from Agent-Forge's `agents.json`.
 * See docs/plans/ai-and-roundtable.md AD-1 / AD-7.
 *
 * Each entry describes the one-shot CLI invocation for a known tool.
 * The registry is deliberately narrow: only tools for which we can spawn a
 * non-interactive process and capture structured output. TUI-only tools
 * (aider, opencode) are omitted for Phase 1.
 */

import type { AgentTool } from "../types.js";
import type { AgentProgram } from "./types.js";

/**
 * Typed program table. Keyed by the literal tool name stored on `Profile.tool`.
 *
 * Claude (`claude -p <prompt> --output-format stream-json --verbose`):
 *   - stream-json emits line-delimited JSON per message/content_block.
 *   - MCP injection via `--mcp-config <file>`.
 *
 * Codex (`codex exec --json`):
 *   - Reads prompt from stdin, emits one JSON event per line.
 *   - MCP injection via repeated `-c mcp.servers.<name>.<field>=<value>` args.
 *
 * Gemini (`gemini -p <prompt>`):
 *   - Plain text on stdout; structured tool events flow through MCP side-channel.
 *   - MCP injection via pre-launch `gemini mcp add` command.
 */
export const AGENT_PROGRAMS: Record<string, AgentProgram> = {
  claude: {
    tool: "claude",
    command: "claude",
    oneShotFlags: ["-p", "--output-format", "stream-json", "--verbose"],
    inputMethod: "direct",
    mcpMode: "config-file",
    outputFormat: "stream-json",
    readyMarker: "\u276F", // ❯
  },
  codex: {
    tool: "codex",
    command: "codex",
    oneShotFlags: ["exec", "--json"],
    inputMethod: "direct",
    mcpMode: "config-args",
    outputFormat: "codex-json",
    readyMarker: "\u203A", // ›
  },
  gemini: {
    tool: "gemini",
    command: "gemini",
    oneShotFlags: ["-p"],
    inputMethod: "direct",
    mcpMode: "mcp-add",
    outputFormat: "plain",
    readyMarker: "Type your message",
  },
};

/**
 * Resolve the registry entry for a given tool name.
 * Returns `undefined` for unknown tools so the caller can surface a clear
 * error rather than getting a partially-constructed program.
 */
export function resolveAgentProgram(tool: AgentTool | undefined): AgentProgram | undefined {
  if (!tool) return undefined;
  return AGENT_PROGRAMS[tool];
}
