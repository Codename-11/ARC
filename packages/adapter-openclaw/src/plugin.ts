/**
 * OpenClaw plugin entry point for the ARC adapter.
 *
 * This module exports the `register(api)` function that OpenClaw's jiti
 * loader calls when the plugin is loaded inside the Gateway process.
 * It registers ARC supervision hooks and agent tools into OpenClaw's
 * lifecycle bus.
 */

import type { OpenClawPluginApi } from "./types.js";
import { beforePromptBuild, agentEnd, sessionEnd } from "./hooks.js";
import { allTools } from "./tools.js";

/**
 * Plugin registration entry point.
 *
 * Called by OpenClaw's plugin loader with the plugin API object.
 * Registers 3 lifecycle hooks and 5 agent tools.
 */
export default function register(api: OpenClawPluginApi): void {
  // ─── Lifecycle hooks ───────────────────────────────────────────────

  api.registerHook("before_prompt_build", beforePromptBuild, {
    name: "arc-before-prompt-build",
    description: "Injects ARC supervision context before prompt construction.",
  });

  api.registerHook("agent_end", agentEnd, {
    name: "arc-agent-end",
    description: "Evaluates ARC completion criteria at agent run end.",
  });

  api.registerHook("session_end", sessionEnd, {
    name: "arc-session-end",
    description: "Cleans up ARC supervision state on session teardown.",
  });

  // ─── Agent tools ───────────────────────────────────────────────────

  for (const tool of allTools) {
    api.registerTool(tool, { optional: true });
  }
}
