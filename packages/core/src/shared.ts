import fs from "node:fs";
import { getSharedSettingsPath } from "./paths.js";
import {
  getSharedManifest,
  pullProfileIntoShared,
  syncSharedLayer,
  unsyncSharedLayer,
  type SharedLayerPullResult,
  type SharedLayerSyncOptions,
} from "./shared-layer.js";
import type { SharedManifest } from "./types.js";

export type PullResult = SharedLayerPullResult;

export function getSharedSettings(): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(getSharedSettingsPath(), "utf-8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function getSharedSourceTool(): string | null {
  const settings = getSharedSettings();
  const tool = settings?.["_sourceTool"];
  return typeof tool === "string" ? tool : null;
}

export { getSharedManifest };

export function syncSharedToProfile(
  profileConfigDir: string,
  opts: {
    memory?: boolean;
    projects?: boolean;
    artifactMode?: "sync" | "unsync" | "preserve";
    adapterArtifactSync?: (() => string[]) | undefined;
    targetTool?: string;
  } = {},
  _targetTool?: string
): { warning?: string; manifest: SharedManifest } {
  const syncOpts: SharedLayerSyncOptions = {
    memory: opts.memory,
    projects: opts.projects,
    adapterArtifactSync: opts.adapterArtifactSync,
  };
  const manifest = syncSharedLayer(profileConfigDir, syncOpts);
  return { warning: undefined, manifest };
}

export function unsyncSharedFromProfile(
  profileConfigDir: string,
  removeAdapterArtifacts?: () => void
): void {
  unsyncSharedLayer(profileConfigDir, removeAdapterArtifacts);
}

export function pullProfileToShared(
  profileConfigDir: string,
  _sourceTool?: string
): PullResult {
  return pullProfileIntoShared(profileConfigDir);
}

export { syncSharedLayer, unsyncSharedLayer, pullProfileIntoShared };
export type { SharedManifest };
