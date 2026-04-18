/**
 * Dispatcher — pick the right `AgentClient` for a given profile.
 *
 * Unsupported tools (`hermes`, `openclaw`, unknown) throw a clear error so
 * the caller can decide whether to fall back or surface a user-facing message.
 */

import type { Profile } from "../types.js";
import type { AgentClient } from "./types.js";
import { ClaudeAgentClient } from "./claude.js";
import { CodexAgentClient } from "./codex.js";
import { GeminiAgentClient } from "./gemini.js";
import { AGENT_PROGRAMS } from "./registry.js";

export interface DispatchOptions {
  /** Working directory override. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Extra env on top of `profile.envOverrides`. */
  extraEnv?: NodeJS.ProcessEnv;
}

/**
 * Build the child process environment from a profile. Merges:
 *   1. `process.env`
 *   2. profile-level env overrides
 *   3. `ARC_CONFIG_DIR` set to the profile's isolated config dir
 *   4. caller-supplied `extraEnv`
 */
export function buildProfileEnv(profile: Profile, extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (profile.envOverrides) {
    for (const [k, v] of Object.entries(profile.envOverrides)) {
      env[k] = v;
    }
  }
  if (profile.configDir) {
    env["ARC_CONFIG_DIR"] = profile.configDir;
  }
  if (extraEnv) {
    for (const [k, v] of Object.entries(extraEnv)) {
      if (v !== undefined) env[k] = v;
    }
  }
  return env;
}

/**
 * Return an `AgentClient` bound to the profile's tool, configDir, and env.
 * Throws for tools that don't have a CLI-spawn implementation yet.
 */
export function getAgentClientForProfile(profile: Profile, dispatch: DispatchOptions = {}): AgentClient {
  const tool = profile.tool;
  if (!tool) {
    throw new Error(`Profile has no tool set; cannot build an AgentClient`);
  }
  const program = AGENT_PROGRAMS[tool];
  if (!program) {
    throw new Error(
      `No AgentClient implementation for tool "${tool}". Supported: ${Object.keys(AGENT_PROGRAMS).join(", ")}.`,
    );
  }

  const env = buildProfileEnv(profile, dispatch.extraEnv);
  const cwd = dispatch.cwd;

  switch (tool) {
    case "claude":
      return new ClaudeAgentClient({ cwd, env });
    case "codex":
      return new CodexAgentClient({ cwd, env });
    case "gemini":
      return new GeminiAgentClient({ cwd, env });
    default:
      // Unreachable given the registry lookup above, but keeps TS exhaustive.
      throw new Error(`Unsupported tool: ${tool}`);
  }
}
