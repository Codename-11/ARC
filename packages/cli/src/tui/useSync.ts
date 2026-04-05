import { useState, useEffect, useCallback } from "react";
import {
  getSharedManifest,
  getSharedSettings,
  getSharedSourceTool,
  syncSharedToProfile,
  pullProfileToShared,
} from "@axiom-labs/arc-core";
import type { SharedManifest } from "@axiom-labs/arc-core";
import { loadConfig } from "../config.js";

export type { SharedManifest };

export interface SyncItem {
  name: string;
  kind: string;
  status: "synced" | "empty" | "disabled";
  count?: number;
}

export interface SyncState {
  items: SyncItem[];
  sourceTool: string | null;
  sharedSettings: Record<string, unknown> | null;
  manifests: Map<string, SharedManifest | null>;
  loading: boolean;
  reload: () => void;
  pullFromProfile: (profileName: string) => { ok: boolean; message: string };
  pushToProfile: (profileName: string) => { ok: boolean; message: string };
}

export function useSync(): SyncState {
  const [tick, setTick] = useState(0);
  const [items, setItems] = useState<SyncItem[]>([]);
  const [sourceTool, setSourceTool] = useState<string | null>(null);
  const [sharedSettings, setSharedSettings] = useState<Record<string, unknown> | null>(null);
  const [manifests, setManifests] = useState<Map<string, SharedManifest | null>>(new Map());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    try {
      const config = loadConfig();
      const settings = getSharedSettings();
      const tool = getSharedSourceTool();

      // Gather manifests from all profiles
      const profileManifests = new Map<string, SharedManifest | null>();
      const allMcpServers = new Set<string>();
      const allCommands = new Set<string>();
      let hasClaudeMd = false;
      let hasMemory = false;
      let hasProjects = false;

      for (const [name, profile] of Object.entries(config.profiles)) {
        const manifest = getSharedManifest(profile.configDir);
        profileManifests.set(name, manifest);
        if (manifest) {
          for (const mcp of manifest.mcpServers) allMcpServers.add(mcp);
          for (const cmd of manifest.commands) allCommands.add(cmd);
          if (manifest.memoryLinked) hasMemory = true;
          if (manifest.projectsLinked) hasProjects = true;
        }
      }

      // Check shared CLAUDE.md existence from settings
      if (settings?.["_sourceTool"]) {
        hasClaudeMd = true;
      }

      const syncItems: SyncItem[] = [
        {
          name: "MCP Servers",
          kind: "mcp",
          status: allMcpServers.size > 0 ? "synced" : "empty",
          count: allMcpServers.size,
        },
        {
          name: "Commands",
          kind: "commands",
          status: allCommands.size > 0 ? "synced" : "empty",
          count: allCommands.size,
        },
        {
          name: "CLAUDE.md",
          kind: "claude-md",
          status: hasClaudeMd ? "synced" : "empty",
        },
        {
          name: "Memory",
          kind: "memory",
          status: hasMemory ? "synced" : "disabled",
        },
        {
          name: "Projects",
          kind: "projects",
          status: hasProjects ? "synced" : "disabled",
        },
      ];

      if (!cancelled) {
        setItems(syncItems);
        setSourceTool(tool);
        setSharedSettings(settings);
        setManifests(profileManifests);
        setLoading(false);
      }
    } catch {
      if (!cancelled) {
        setItems([]);
        setSourceTool(null);
        setSharedSettings(null);
        setManifests(new Map());
        setLoading(false);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [tick]);

  const pullFromProfile = useCallback(
    (profileName: string): { ok: boolean; message: string } => {
      try {
        const config = loadConfig();
        const profile = config.profiles[profileName];
        if (!profile) return { ok: false, message: `Profile '${profileName}' not found` };

        const result = pullProfileToShared(profile.configDir, profile.tool);
        const parts: string[] = [];
        if (result.mcpServers.length) parts.push(`${result.mcpServers.length} MCPs`);
        if (result.commands.length) parts.push(`${result.commands.length} commands`);
        reload();
        return { ok: true, message: parts.length > 0 ? `Pulled: ${parts.join(", ")}` : "Nothing to pull" };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
    [reload],
  );

  const pushToProfile = useCallback(
    (profileName: string): { ok: boolean; message: string } => {
      try {
        const config = loadConfig();
        const profile = config.profiles[profileName];
        if (!profile) return { ok: false, message: `Profile '${profileName}' not found` };

        const { manifest, warning } = syncSharedToProfile(profile.configDir, {}, profile.tool);
        const parts: string[] = [];
        if (manifest.mcpServers.length) parts.push(`${manifest.mcpServers.length} MCPs`);
        if (manifest.commands.length) parts.push(`${manifest.commands.length} commands`);
        const detail = parts.length > 0 ? `Pushed: ${parts.join(", ")}` : "Shared layer synced";
        const msg = warning ? `${detail} (${warning})` : detail;
        reload();
        return { ok: true, message: msg };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
    [reload],
  );

  return { items, sourceTool, sharedSettings, manifests, loading, reload, pullFromProfile, pushToProfile };
}
