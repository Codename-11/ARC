import fs from "node:fs";
import path from "node:path";
import {
  getSharedCommandsDir,
  getSharedMemoryDir,
  getSharedProjectsDir,
  getSharedSettingsPath,
} from "./paths.js";
import type { SharedManifest } from "./types.js";

const MANIFEST_FILE = ".arc-shared.json";

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function isSymlink(dirPath: string): boolean {
  try {
    return fs.lstatSync(dirPath).isSymbolicLink();
  } catch {
    return false;
  }
}

function createLink(targetDir: string, linkPath: string): void {
  fs.mkdirSync(targetDir, { recursive: true });

  if (fs.existsSync(linkPath) || isSymlink(linkPath)) {
    fs.rmSync(linkPath, { recursive: true, force: true });
  }

  fs.symlinkSync(targetDir, linkPath, process.platform === "win32" ? "junction" : "dir");
}

function removeLink(targetDir: string, linkPath: string): void {
  if (!isSymlink(linkPath)) return;
  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.mkdirSync(linkPath, { recursive: true });

  if (!fs.existsSync(targetDir)) return;
  for (const entry of fs.readdirSync(targetDir)) {
    const src = path.join(targetDir, entry);
    const dest = path.join(linkPath, entry);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
    }
  }
}

export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof base[key] === "object" &&
      base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(
        base[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function getSharedManifest(profileConfigDir: string): SharedManifest | null {
  const manifest = readJson(path.join(profileConfigDir, MANIFEST_FILE));
  if (!manifest) {
    return null;
  }

  return {
    syncedAt: String(manifest["syncedAt"] ?? ""),
    mcpServers: Array.isArray(manifest["mcpServers"]) ? (manifest["mcpServers"] as string[]) : [],
    commands: Array.isArray(manifest["commands"]) ? (manifest["commands"] as string[]) : [],
    memoryLinked: manifest["memoryLinked"] === true,
    projectsLinked: manifest["projectsLinked"] === true,
    adapterArtifacts: Array.isArray(manifest["adapterArtifacts"])
      ? (manifest["adapterArtifacts"] as string[])
      : [],
  };
}

export interface SharedLayerSyncOptions {
  memory?: boolean;
  projects?: boolean;
  adapterArtifactSync?: (() => string[]) | undefined;
}

export function syncSharedLayer(
  profileConfigDir: string,
  opts: SharedLayerSyncOptions = {}
): SharedManifest {
  const existingManifest = getSharedManifest(profileConfigDir);
  const previousMcpKeys = new Set(existingManifest?.mcpServers ?? []);
  const previousCommands = new Set(existingManifest?.commands ?? []);
  const sharedSettings = readJson(getSharedSettingsPath());
  const settingsPath = path.join(profileConfigDir, "settings.json");
  const profileSettings = readJson(settingsPath) ?? {};
  const mcpServers = (profileSettings["mcpServers"] ?? {}) as Record<string, unknown>;
  const syncedMcpKeys: string[] = [];

  if (sharedSettings) {
    for (const key of previousMcpKeys) {
      delete mcpServers[key];
    }

    const sharedMcp = (sharedSettings["mcpServers"] ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(sharedMcp)) {
      if (!(key in mcpServers)) {
        mcpServers[key] = value;
      }
      syncedMcpKeys.push(key);
    }

    const merged = deepMerge(sharedSettings, profileSettings);
    merged["mcpServers"] = mcpServers;
    writeJson(settingsPath, merged);
  }

  const sharedCommandsDir = getSharedCommandsDir();
  const syncedCommands: string[] = [];
  if (fs.existsSync(sharedCommandsDir)) {
    const profileCommandsDir = path.join(profileConfigDir, "commands");
    fs.mkdirSync(profileCommandsDir, { recursive: true });
    const sharedFiles = new Set(fs.readdirSync(sharedCommandsDir));
    for (const file of previousCommands) {
      if (!sharedFiles.has(file)) {
        const stalePath = path.join(profileCommandsDir, file);
        if (fs.existsSync(stalePath)) fs.unlinkSync(stalePath);
      }
    }
    for (const file of sharedFiles) {
      fs.copyFileSync(path.join(sharedCommandsDir, file), path.join(profileCommandsDir, file));
      syncedCommands.push(file);
    }
  }

  const useMemory = opts.memory ?? (existingManifest?.memoryLinked ?? false);
  const useProjects = opts.projects ?? (existingManifest?.projectsLinked ?? false);

  if (useMemory) createLink(getSharedMemoryDir(), path.join(profileConfigDir, "memory"));
  else if (existingManifest?.memoryLinked) removeLink(getSharedMemoryDir(), path.join(profileConfigDir, "memory"));

  if (useProjects) createLink(getSharedProjectsDir(), path.join(profileConfigDir, "projects"));
  else if (existingManifest?.projectsLinked) removeLink(getSharedProjectsDir(), path.join(profileConfigDir, "projects"));

  const manifest: SharedManifest = {
    syncedAt: new Date().toISOString(),
    mcpServers: syncedMcpKeys,
    commands: syncedCommands,
    memoryLinked: useMemory,
    projectsLinked: useProjects,
    adapterArtifacts: opts.adapterArtifactSync?.() ?? [],
  };

  writeJson(path.join(profileConfigDir, MANIFEST_FILE), manifest);
  return manifest;
}

export function unsyncSharedLayer(
  profileConfigDir: string,
  removeAdapterArtifacts?: () => void
): void {
  const manifest = getSharedManifest(profileConfigDir);
  if (!manifest) return;

  const settingsPath = path.join(profileConfigDir, "settings.json");
  const profileSettings = readJson(settingsPath);
  if (profileSettings) {
    const mcpServers = (profileSettings["mcpServers"] ?? {}) as Record<string, unknown>;
    for (const key of manifest.mcpServers) {
      delete mcpServers[key];
    }
    profileSettings["mcpServers"] = mcpServers;
    writeJson(settingsPath, profileSettings);
  }

  const profileCommandsDir = path.join(profileConfigDir, "commands");
  for (const file of manifest.commands) {
    const commandPath = path.join(profileCommandsDir, file);
    if (fs.existsSync(commandPath)) fs.unlinkSync(commandPath);
  }

  if (manifest.memoryLinked) removeLink(getSharedMemoryDir(), path.join(profileConfigDir, "memory"));
  if (manifest.projectsLinked) removeLink(getSharedProjectsDir(), path.join(profileConfigDir, "projects"));
  removeAdapterArtifacts?.();

  const manifestPath = path.join(profileConfigDir, MANIFEST_FILE);
  if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
}

export interface SharedLayerPullResult {
  mcpServers: string[];
  commands: string[];
  adapterArtifacts: string[];
}

export function pullProfileIntoShared(
  profileConfigDir: string,
  pullAdapterArtifacts?: () => string[]
): SharedLayerPullResult {
  const result: SharedLayerPullResult = {
    mcpServers: [],
    commands: [],
    adapterArtifacts: pullAdapterArtifacts?.() ?? [],
  };

  const profileSettings = readJson(path.join(profileConfigDir, "settings.json"));
  if (profileSettings) {
    const mcpServers = (profileSettings["mcpServers"] ?? {}) as Record<string, unknown>;
    const keys = Object.keys(mcpServers);
    if (keys.length > 0) {
      const sharedSettings = readJson(getSharedSettingsPath()) ?? {};
      const existing = (sharedSettings["mcpServers"] ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(mcpServers)) {
        existing[key] = value;
      }
      sharedSettings["mcpServers"] = existing;
      writeJson(getSharedSettingsPath(), sharedSettings);
      result.mcpServers = keys;
    }
  }

  const profileCommandsDir = path.join(profileConfigDir, "commands");
  if (fs.existsSync(profileCommandsDir)) {
    const sharedCommandsDir = getSharedCommandsDir();
    fs.mkdirSync(sharedCommandsDir, { recursive: true });
    for (const file of fs.readdirSync(profileCommandsDir).filter((entry) => !entry.startsWith("."))) {
      fs.copyFileSync(path.join(profileCommandsDir, file), path.join(sharedCommandsDir, file));
      result.commands.push(file);
    }
  }

  return result;
}
