import { loadConfig } from "../config.js";
import {
  resolveEffectiveProfile,
  loadWorkspaceConfig,
} from "@axiom-labs/arc-core";
import { error } from "../display.js";
import type { ArcConfig } from "../types.js";

/**
 * Display the resolved profile for the current working directory,
 * showing whether it came from arc.json or the active config,
 * inheritance chain, tool, auth type, enforcement (with arc.json
 * annotation), and config directory.
 */
export async function handleWhich(): Promise<void> {
  let config: ArcConfig;
  try {
    config = loadConfig();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error(msg);
    process.exit(1);
  }

  let result: ReturnType<typeof resolveEffectiveProfile>;
  try {
    result = resolveEffectiveProfile(config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error(msg);
    process.exit(1);
  }

  const { profile, profileName, workspacePath } = result;

  // Determine profile source annotation
  const sourceAnnotation = workspacePath
    ? `${profileName} (from arc.json at ${workspacePath})`
    : `${profileName} (active profile \u2014 no arc.json found)`;

  // Look up raw profile for inherits field
  const rawProfile = config.profiles[profileName];
  if (!rawProfile) {
    error(`Profile "${profileName}" not found.`);
    process.exit(1);
  }

  // Check if arc.json overrides enforcement
  const workspace = loadWorkspaceConfig();
  const enforcementValue = profile.enforcement ?? "log";
  let enforcementDisplay = String(enforcementValue);

  if (workspace?.config.enforcement !== undefined) {
    // The raw profile's own enforcement (before any workspace override)
    const profileOwnEnforcement = rawProfile.enforcement;
    if (workspace.config.enforcement !== profileOwnEnforcement) {
      enforcementDisplay = `${enforcementValue} (overridden by arc.json)`;
    }
  }

  // Output
  process.stdout.write(`Profile:     ${sourceAnnotation}\n`);
  if (rawProfile.inherits) {
    process.stdout.write(`Inherits:    ${rawProfile.inherits}\n`);
  }
  process.stdout.write(`Tool:        ${profile.tool ?? "claude"}\n`);
  process.stdout.write(`Auth Type:   ${profile.authType}\n`);
  process.stdout.write(`Enforcement: ${enforcementDisplay}\n`);
  process.stdout.write(`Config Dir:  ${profile.configDir}\n`);
}
