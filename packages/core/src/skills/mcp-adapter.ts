/**
 * MCP adapter — wraps an MCP tool descriptor as a Skill.
 */

import type { Skill } from "./types.js";

/**
 * Convert an MCP tool into a Skill definition.
 *
 * The resulting skill has a single step that invokes the MCP tool,
 * source is set to `"mcp"`, and the trigger list includes the tool name.
 */
export function mcpToSkill(tool: {
  name: string;
  description: string;
}): Skill {
  return {
    name: tool.name,
    description: tool.description,
    trigger: [tool.name],
    steps: [
      {
        action: `invoke:${tool.name}`,
        description: tool.description,
        onError: "abort",
      },
    ],
    tools: [tool.name],
    adapters: [],
    source: "mcp",
    created: new Date().toISOString(),
    successRate: 0,
  };
}
