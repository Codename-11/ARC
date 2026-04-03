// ---------------------------------------------------------------------------
// Phase 23 — Plugin Registry types
// ---------------------------------------------------------------------------

export type PluginCapability = "adapter" | "hook" | "skill" | "mcp" | "dashboard";

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  capabilities: PluginCapability[];
  compatibility: { arc: string }; // semver range
  entryPoint?: string;
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  path: string;
  enabled: boolean;
  installedAt: string;
}
