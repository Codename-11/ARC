import path from "node:path";
import { readJsonObject, deepMerge } from "./shared-fs.js";
import { resolveProfile, resolveProfileName } from "./config.js";
import type { ArcConfig, Profile, EnforcementMode, HookConfig } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────────

/**
 * Workspace-level configuration read from an `arc.json` file in a
 * project directory. Fields override the resolved profile when present.
 */
export interface ArcJsonConfig {
  version: 1;
  profile?: string;
  adapter?: string;
  enforcement?: EnforcementMode;
  hooks?: Record<string, HookConfig>;
  mcpServers?: Record<string, unknown>;
}

/** Result of successfully locating and parsing an `arc.json`. */
export interface WorkspaceResult {
  config: ArcJsonConfig;
  /** Absolute path to the directory containing the `arc.json` file. */
  path: string;
}

// ─── Validation helpers ──────────────────────────────────────────────

const VALID_ENFORCEMENT = new Set<string>(["off", "log", "advise", "enforce"]);

function isValidArcJson(obj: Record<string, unknown>): boolean {
  if (obj["version"] !== 1) return false;

  if (obj["profile"] !== undefined && typeof obj["profile"] !== "string") return false;
  if (obj["adapter"] !== undefined && typeof obj["adapter"] !== "string") return false;
  if (
    obj["enforcement"] !== undefined &&
    (typeof obj["enforcement"] !== "string" ||
      !VALID_ENFORCEMENT.has(obj["enforcement"]))
  )
    return false;

  if (obj["hooks"] !== undefined) {
    if (typeof obj["hooks"] !== "object" || obj["hooks"] === null || Array.isArray(obj["hooks"]))
      return false;
  }

  if (obj["mcpServers"] !== undefined) {
    if (
      typeof obj["mcpServers"] !== "object" ||
      obj["mcpServers"] === null ||
      Array.isArray(obj["mcpServers"])
    )
      return false;
  }

  return true;
}

// ─── loadWorkspaceConfig ─────────────────────────────────────────────

/**
 * Walk up from `cwd` (default `process.cwd()`) looking for the nearest
 * `arc.json`. Returns the parsed config and its directory path, or
 * `null` if none is found or the file is invalid/incompatible.
 */
export function loadWorkspaceConfig(cwd?: string): WorkspaceResult | null {
  let dir = path.resolve(cwd ?? process.cwd());

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const filePath = path.join(dir, "arc.json");
    const obj = readJsonObject(filePath);

    if (obj !== null && isValidArcJson(obj)) {
      return { config: obj as unknown as ArcJsonConfig, path: dir };
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      // Reached filesystem root — stop.
      return null;
    }
    dir = parent;
  }
}

// ─── applyWorkspaceOverrides ─────────────────────────────────────────

/**
 * Apply workspace-level overrides from an `arc.json` onto a resolved
 * profile. Returns a **new** profile object — the input is not mutated.
 */
export function applyWorkspaceOverrides(
  resolvedProfile: Profile,
  workspace: ArcJsonConfig
): Profile {
  // Start with a shallow copy
  const result: Profile = { ...resolvedProfile };

  // Replace scalar overrides
  if (workspace.enforcement !== undefined) {
    result.enforcement = workspace.enforcement;
  }
  if (workspace.adapter !== undefined) {
    result.tool = workspace.adapter;
  }

  // Deep-merge hooks
  if (workspace.hooks !== undefined) {
    result.hooks = deepMerge(
      (resolvedProfile.hooks ?? {}) as Record<string, unknown>,
      workspace.hooks as unknown as Record<string, unknown>
    ) as unknown as Record<string, HookConfig>;
  }

  // Deep-merge mcpServers (stored in a generic bucket on Profile — pass-through)
  if (workspace.mcpServers !== undefined) {
    const existing =
      ((resolvedProfile as unknown as Record<string, unknown>)["mcpServers"] as
        | Record<string, unknown>
        | undefined) ?? {};
    (result as unknown as Record<string, unknown>)["mcpServers"] = deepMerge(
      existing,
      workspace.mcpServers as Record<string, unknown>
    );
  }

  return result;
}

// ─── resolveEffectiveProfile ─────────────────────────────────────────

export interface EffectiveProfileResult {
  profile: Profile;
  profileName: string;
  workspacePath: string | null;
}

/**
 * Full resolution pipeline:
 *  1. Detect arc.json in the working directory tree.
 *  2. Determine profile name (arc.json > explicit > activeProfile).
 *  3. Resolve profile inheritance.
 *  4. Apply workspace overrides.
 */
export function resolveEffectiveProfile(
  config: ArcConfig,
  explicitName?: string,
  cwd?: string
): EffectiveProfileResult {
  const workspace = loadWorkspaceConfig(cwd);

  // Determine profile name: arc.json.profile > explicitName > config.activeProfile
  const profileName =
    workspace?.config.profile ??
    resolveProfileName(config, explicitName);

  // Resolve through inheritance chain
  let profile: Profile;
  try {
    profile = resolveProfile(config, profileName);
  } catch (err) {
    // Enhance error message when the profile name came from arc.json
    if (
      workspace?.config.profile !== undefined &&
      err instanceof Error &&
      err.message.includes("not found")
    ) {
      throw new Error(
        `${err.message} (referenced by arc.json in ${workspace.path})`
      );
    }
    throw err;
  }

  // Apply workspace overrides if arc.json exists
  if (workspace) {
    profile = applyWorkspaceOverrides(profile, workspace.config);
  }

  return {
    profile,
    profileName,
    workspacePath: workspace?.path ?? null,
  };
}
