/**
 * OpenClaw plugin entry point for the ARC adapter.
 *
 * This module exports the `register(api)` function that OpenClaw's jiti
 * loader calls when the plugin is loaded inside the Gateway process.
 * It registers ARC supervision hooks and agent tools into OpenClaw's
 * lifecycle bus.
 */

import type { OpenClawPluginApi } from "./types.js";
import type { Profile } from "@axiom-labs/arc-core";
import { createArcHookHandlers } from "./hooks.js";
import { allTools } from "./tools.js";

/**
 * Plugin registration entry point.
 *
 * Called by OpenClaw's plugin loader with the plugin API object.
 * Registers 3 lifecycle hooks (backed by ARC pipeline) and 5 agent tools.
 */
export default function register(api: OpenClawPluginApi): void {
  // ─── Build ARC hook handlers from profile config ─────────────────

  const profile: Profile = (api.config?.profile as Profile) ?? {
    authType: "api-key",
    configDir: String(api.config?.configDir ?? "/tmp/arc"),
    createdAt: new Date().toISOString(),
    enforcement: (api.config?.enforcement as Profile["enforcement"]) ?? "log",
    hooks: (api.config?.hooks as Profile["hooks"]) ?? undefined,
  };

  const handlers = createArcHookHandlers(profile);

  // ─── Lifecycle hooks ───────────────────────────────────────────────

  api.registerHook("before_prompt_build", handlers.beforePromptBuild, {
    name: "arc-before-prompt-build",
    description: "Runs ARC pre-message pipeline: source classification, risk detection, and supervision gates.",
  });

  api.registerHook("agent_end", handlers.agentEnd, {
    name: "arc-agent-end",
    description: "Runs ARC post-message pipeline: audit scoring, supervision gate, and health verification.",
  });

  api.registerHook("session_end", handlers.sessionEnd, {
    name: "arc-session-end",
    description: "Cleans up ARC supervision state on session teardown.",
  });

  // ─── Agent tools ───────────────────────────────────────────────────

  for (const tool of allTools) {
    api.registerTool(tool, { optional: true });
  }
}
