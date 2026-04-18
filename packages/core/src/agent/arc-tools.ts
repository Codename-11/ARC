/**
 * ARC tool catalog — the concrete set of tools an agent can call against
 * ARC's installed state. All handlers delegate to existing core functions;
 * no policy logic lives here.
 *
 * See `docs/plans/ai-and-roundtable.md` AD-3 for the full planned catalog;
 * this module ships the Phase 2 baseline (≥15 tools spanning all three
 * permission tiers).
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadConfig, saveConfig, cloneProfile } from "../config.js";
import { getRecentLaunches } from "../history.js";
import { queryLogEvents, type LogLevel } from "../logging.js";
import { SkillRegistry } from "../skills/index.js";
import { PersistentMemory, type MemoryScope } from "../memory/index.js";
import { TaskStore, type TaskStatus } from "../tasks/index.js";
import { RemoteAgentRegistry } from "../remote.js";
import { getSharedSettings } from "../shared.js";
import type { ToolRegistry } from "./registry.js";
import type { Tool } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOG_LEVEL_VALUES = ["debug", "info", "warn", "error"] as const;

const MEMORY_SCOPE_VALUES = ["session", "persistent", "profile", "team"] as const;

const TASK_STATUS_VALUES = [
  "created",
  "assigned",
  "working",
  "input-required",
  "completed",
  "failed",
  "cancelled",
] as const;

/**
 * Locate the core package.json at runtime (compiled output lives at
 * `packages/core/dist/index.js`, so `../package.json` resolves in both
 * source and built form via the `src` → `dist` layout).
 */
function readCorePackageVersion(): string {
  const candidates = [
    path.resolve(new URL(".", import.meta.url).pathname, "../../package.json"),
    path.resolve(new URL(".", import.meta.url).pathname, "../package.json"),
  ];
  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, "utf-8");
      const parsed = JSON.parse(raw) as { version?: string; name?: string };
      if (parsed.name === "@axiom-labs/arc-core" && typeof parsed.version === "string") {
        return parsed.version;
      }
    } catch {
      // try next
    }
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

const listProfilesTool: Tool = {
  name: "list_profiles",
  description: "List all ARC profiles with their tool, authType, and description.",
  permission: "read",
  schema: z.object({}),
  handler: async () => {
    const cfg = loadConfig();
    return Object.entries(cfg.profiles).map(([name, prof]) => ({
      name,
      tool: prof.tool,
      authType: prof.authType,
      description: prof.description,
      createdAt: prof.createdAt,
    }));
  },
};

const showProfileTool: Tool = {
  name: "show_profile",
  description: "Return the full record of a single profile by name.",
  permission: "read",
  schema: z.object({ name: z.string() }),
  handler: async (input) => {
    const { name } = input as { name: string };
    const cfg = loadConfig();
    const prof = cfg.profiles[name];
    if (!prof) throw new Error(`Profile '${name}' not found`);
    return { name, ...prof };
  },
};

const getActiveProfileTool: Tool = {
  name: "get_active_profile",
  description: "Return the name and record of the currently active profile, or null if none is active.",
  permission: "read",
  schema: z.object({}),
  handler: async () => {
    const cfg = loadConfig();
    const name = cfg.activeProfile as string | null;
    if (!name) return null;
    const prof = cfg.profiles[name];
    if (!prof) return null;
    return { name, ...prof };
  },
};

const listLaunchesTool: Tool = {
  name: "list_launches",
  description: "List recent profile launch history entries (most-recent first).",
  permission: "read",
  schema: z.object({ limit: z.number().int().positive().optional() }),
  handler: async (input) => {
    const { limit } = input as { limit?: number };
    return getRecentLaunches(limit ?? 10);
  },
};

const queryLogsTool: Tool = {
  name: "query_logs",
  description: "Query ARC's structured log with optional level/component filters.",
  permission: "read",
  schema: z.object({
    limit: z.number().int().positive().optional(),
    level: z.enum(LOG_LEVEL_VALUES).optional(),
    component: z.string().optional(),
  }),
  handler: async (input) => {
    const { limit, level, component } = input as {
      limit?: number;
      level?: LogLevel;
      component?: string;
    };
    return queryLogEvents({ limit, level, component });
  },
};

const listSkillsTool: Tool = {
  name: "list_skills",
  description: "List skills in the in-memory SkillRegistry.",
  permission: "read",
  schema: z.object({}),
  handler: async () => {
    // SkillRegistry is ephemeral; Phase 2 returns an empty registry snapshot.
    // Callers that keep a shared registry should inject one via a future ctx hook.
    const registry = new SkillRegistry();
    return registry.list();
  },
};

const listMemoriesTool: Tool = {
  name: "list_memories",
  description: "List entries from a PersistentMemory scope (default 'persistent').",
  permission: "read",
  schema: z.object({
    limit: z.number().int().positive().optional(),
    scope: z.enum(MEMORY_SCOPE_VALUES).optional(),
  }),
  handler: async (input) => {
    const { limit, scope } = input as { limit?: number; scope?: MemoryScope };
    const store = new PersistentMemory(scope ?? "persistent");
    const entries = store.list();
    return typeof limit === "number" ? entries.slice(0, limit) : entries;
  },
};

const listTasksTool: Tool = {
  name: "list_tasks",
  description: "List tasks from the TaskStore, optionally filtered by status.",
  permission: "read",
  schema: z.object({ status: z.enum(TASK_STATUS_VALUES).optional() }),
  handler: async (input) => {
    const { status } = input as { status?: TaskStatus };
    const store = new TaskStore();
    return store.list(status ? { status } : undefined);
  },
};

const listRemoteAgentsTool: Tool = {
  name: "list_remote_agents",
  description: "List all registered remote agents and their status.",
  permission: "read",
  schema: z.object({}),
  handler: async () => {
    const registry = new RemoteAgentRegistry();
    return registry.list();
  },
};

const listMcpServersTool: Tool = {
  name: "list_mcp_servers",
  description: "List MCP servers configured in the shared layer settings.",
  permission: "read",
  schema: z.object({}),
  handler: async () => {
    const settings = getSharedSettings();
    if (!settings) return [];
    const servers = settings["mcpServers"];
    if (!servers || typeof servers !== "object") return [];
    return Object.entries(servers as Record<string, unknown>).map(([name, def]) => ({
      name,
      config: def,
    }));
  },
};

const getArcVersionTool: Tool = {
  name: "get_arc_version",
  description: "Return the installed ARC core package version string.",
  permission: "read",
  schema: z.object({}),
  handler: async () => {
    return { version: readCorePackageVersion() };
  },
};

// ---------------------------------------------------------------------------
// Write tools
// ---------------------------------------------------------------------------

const cloneProfileTool: Tool = {
  name: "clone_profile",
  description: "Clone a profile to a new name. Optionally copy its configDir on disk.",
  permission: "write",
  schema: z.object({
    src: z.string(),
    dst: z.string(),
    copyConfigDir: z.boolean().optional(),
  }),
  handler: async (input) => {
    const { src, dst, copyConfigDir } = input as {
      src: string;
      dst: string;
      copyConfigDir?: boolean;
    };
    const cfg = loadConfig();
    const updated = cloneProfile(cfg, src, dst, { copyConfigDir });
    saveConfig(updated);
    return { src, dst, ok: true };
  },
};

const switchActiveProfileTool: Tool = {
  name: "switch_active_profile",
  description: "Set the active ARC profile. Pass null to clear the active profile.",
  permission: "write",
  schema: z.object({ name: z.string().nullable() }),
  handler: async (input) => {
    const { name } = input as { name: string | null };
    const cfg = loadConfig();
    if (name !== null && !cfg.profiles[name]) {
      throw new Error(`Profile '${name}' not found`);
    }
    // Guard: activeProfile may be `string | null` concurrently.
    (cfg as { activeProfile: string | null }).activeProfile = name;
    saveConfig(cfg as typeof cfg);
    return { activeProfile: name, ok: true };
  },
};

const setProfileInstructionsTool: Tool = {
  name: "set_profile_instructions",
  description:
    "Set the `instructions` or `instructionsFile` field of a profile. Omit both to clear.",
  permission: "write",
  schema: z.object({
    profileName: z.string(),
    instructions: z.string().optional(),
    instructionsFile: z.string().optional(),
  }),
  handler: async (input) => {
    const { profileName, instructions, instructionsFile } = input as {
      profileName: string;
      instructions?: string;
      instructionsFile?: string;
    };
    const cfg = loadConfig();
    const prof = cfg.profiles[profileName];
    if (!prof) throw new Error(`Profile '${profileName}' not found`);
    if (instructions === undefined) {
      delete prof.instructions;
    } else {
      prof.instructions = instructions;
    }
    if (instructionsFile === undefined) {
      delete prof.instructionsFile;
    } else {
      prof.instructionsFile = instructionsFile;
    }
    saveConfig(cfg);
    return {
      profileName,
      instructions: prof.instructions,
      instructionsFile: prof.instructionsFile,
    };
  },
};

const setProfileFlagsTool: Tool = {
  name: "set_profile_flags",
  description: "Replace the launchArgs array on a profile.",
  permission: "write",
  schema: z.object({
    profileName: z.string(),
    flags: z.array(z.string()),
  }),
  handler: async (input) => {
    const { profileName, flags } = input as { profileName: string; flags: string[] };
    const cfg = loadConfig();
    const prof = cfg.profiles[profileName];
    if (!prof) throw new Error(`Profile '${profileName}' not found`);
    prof.launchArgs = [...flags];
    saveConfig(cfg);
    return { profileName, launchArgs: prof.launchArgs };
  },
};

// ---------------------------------------------------------------------------
// Dangerous tools
// ---------------------------------------------------------------------------

const deleteProfileTool: Tool = {
  name: "delete_profile",
  description:
    "Delete a profile from ARC config. Does NOT remove the profile's configDir on disk.",
  permission: "dangerous",
  schema: z.object({ name: z.string() }),
  handler: async (input) => {
    const { name } = input as { name: string };
    const cfg = loadConfig();
    if (!cfg.profiles[name]) {
      throw new Error(`Profile '${name}' not found`);
    }
    delete cfg.profiles[name];
    const activeProfile = cfg.activeProfile as string | null;
    if (activeProfile === name) {
      (cfg as { activeProfile: string | null }).activeProfile = null;
    }
    if (Array.isArray(cfg.profileOrder)) {
      cfg.profileOrder = cfg.profileOrder.filter((n) => n !== name);
    }
    saveConfig(cfg);
    return { name, deleted: true };
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register ARC's Phase 2 tool catalog on the given registry.
 * Safe to call once at startup; attempting to register the same tool twice
 * will throw via the registry's duplicate-name guard.
 */
export function registerArcTools(registry: ToolRegistry): void {
  const tools = [
    // Read
    listProfilesTool,
    showProfileTool,
    getActiveProfileTool,
    listLaunchesTool,
    queryLogsTool,
    listSkillsTool,
    listMemoriesTool,
    listTasksTool,
    listRemoteAgentsTool,
    listMcpServersTool,
    getArcVersionTool,
    // Write
    cloneProfileTool,
    switchActiveProfileTool,
    setProfileInstructionsTool,
    setProfileFlagsTool,
    // Dangerous
    deleteProfileTool,
  ];

  for (const tool of tools) {
    registry.register(tool);
  }
}

/** Exposed for tests and introspection. */
export const ARC_TOOLS = Object.freeze({
  list_profiles: listProfilesTool,
  show_profile: showProfileTool,
  get_active_profile: getActiveProfileTool,
  list_launches: listLaunchesTool,
  query_logs: queryLogsTool,
  list_skills: listSkillsTool,
  list_memories: listMemoriesTool,
  list_tasks: listTasksTool,
  list_remote_agents: listRemoteAgentsTool,
  list_mcp_servers: listMcpServersTool,
  get_arc_version: getArcVersionTool,
  clone_profile: cloneProfileTool,
  switch_active_profile: switchActiveProfileTool,
  set_profile_instructions: setProfileInstructionsTool,
  set_profile_flags: setProfileFlagsTool,
  delete_profile: deleteProfileTool,
});
