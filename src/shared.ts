import fs from "node:fs";
import path from "node:path";
import {
  getSharedSettingsPath,
  getSharedCommandsDir,
  getSharedClaudeMdPath,
  getSharedMemoryDir,
  getSharedProjectsDir,
} from "./paths.js";

const MANIFEST_FILE = ".arc-shared.json";

const CLAUDE_MD_START = "<!-- arc:shared:start -->";
const CLAUDE_MD_END = "<!-- arc:shared:end -->";

export interface SharedManifest {
  syncedAt: string;
  /** MCP server keys that were injected from shared into this profile. */
  mcpServers: string[];
  /** Command filenames that were copied from shared into this profile. */
  commands: string[];
  /** Whether a shared CLAUDE.md block was injected into this profile's CLAUDE.md. */
  claudeMd?: boolean;
  /** Whether this profile's memory/ dir is a junction/symlink to shared/memory/. */
  memoryLinked?: boolean;
  /** Whether this profile's projects/ dir is a junction/symlink to shared/projects/. */
  projectsLinked?: boolean;
}

// ── Utilities ────────────────────────────────────────────────────────────────

/** Deep merge two plain objects. `override` wins on scalar conflicts. */
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

/** Returns true if the path is a directory junction or symlink. */
function isJunctionOrSymlink(dirPath: string): boolean {
  try {
    const lstat = fs.lstatSync(dirPath);
    return lstat.isSymbolicLink();
  } catch {
    return false;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getSharedSettings(): Record<string, unknown> | null {
  return readJson(getSharedSettingsPath());
}

/** Returns the tool that last pushed to the shared layer, if tagged. */
export function getSharedSourceTool(): string | null {
  const settings = getSharedSettings();
  if (!settings) return null;
  const tool = settings["_sourceTool"];
  return typeof tool === "string" ? tool : null;
}

export function getSharedManifest(profileConfigDir: string): SharedManifest | null {
  const manifest = readJson(path.join(profileConfigDir, MANIFEST_FILE));
  if (!manifest) return null;
  return {
    syncedAt: String(manifest["syncedAt"] ?? ""),
    mcpServers: Array.isArray(manifest["mcpServers"])
      ? (manifest["mcpServers"] as string[])
      : [],
    commands: Array.isArray(manifest["commands"])
      ? (manifest["commands"] as string[])
      : [],
    claudeMd: manifest["claudeMd"] === true,
    memoryLinked: manifest["memoryLinked"] === true,
    projectsLinked: manifest["projectsLinked"] === true,
  };
}

// ── CLAUDE.md helpers ─────────────────────────────────────────────────────────

/** Remove the arc:shared sentinel block from content, if present. */
function removeSharedClaudeMdBlock(content: string): string {
  const startIdx = content.indexOf(CLAUDE_MD_START);
  const endIdx = content.indexOf(CLAUDE_MD_END);
  if (startIdx === -1 || endIdx === -1) return content;
  // Remove from start sentinel to end sentinel (inclusive), plus any trailing newline
  const afterEnd = endIdx + CLAUDE_MD_END.length;
  const tail = content.slice(afterEnd).replace(/^\n/, "");
  return (content.slice(0, startIdx) + tail).trimStart();
}

/**
 * Sync shared CLAUDE.md to a profile. Prepends the shared content wrapped in
 * sentinel markers, replacing any previously-injected block.
 */
function syncClaudeMd(profileConfigDir: string): boolean {
  const sharedPath = getSharedClaudeMdPath();
  if (!fs.existsSync(sharedPath)) return false;

  const sharedContent = fs.readFileSync(sharedPath, "utf-8").trim();
  if (!sharedContent) return false;

  const profileClaudeMdPath = path.join(profileConfigDir, "CLAUDE.md");
  const existingContent = fs.existsSync(profileClaudeMdPath)
    ? fs.readFileSync(profileClaudeMdPath, "utf-8")
    : "";

  // Strip any previously-injected block first
  const stripped = removeSharedClaudeMdBlock(existingContent);

  const injected =
    `${CLAUDE_MD_START}\n${sharedContent}\n${CLAUDE_MD_END}\n` +
    (stripped ? `\n${stripped}` : "");

  fs.mkdirSync(profileConfigDir, { recursive: true });
  fs.writeFileSync(profileClaudeMdPath, injected, "utf-8");
  return true;
}

/** Remove the arc:shared sentinel block from a profile's CLAUDE.md. */
function unsyncClaudeMd(profileConfigDir: string): void {
  const profileClaudeMdPath = path.join(profileConfigDir, "CLAUDE.md");
  if (!fs.existsSync(profileClaudeMdPath)) return;

  const content = fs.readFileSync(profileClaudeMdPath, "utf-8");
  const cleaned = removeSharedClaudeMdBlock(content);

  if (cleaned !== content) {
    if (cleaned.trim() === "") {
      fs.unlinkSync(profileClaudeMdPath);
    } else {
      fs.writeFileSync(profileClaudeMdPath, cleaned, "utf-8");
    }
  }
}

// ── Junction / symlink helpers ────────────────────────────────────────────────

/**
 * Create a junction (Windows) or symlink (Unix) at `linkPath` pointing to
 * `targetDir`. If `linkPath` is an existing plain directory with content,
 * files are merged into `targetDir` first, then the directory is replaced.
 */
function createLink(targetDir: string, linkPath: string): void {
  fs.mkdirSync(targetDir, { recursive: true });

  if (fs.existsSync(linkPath) || isJunctionOrSymlink(linkPath)) {
    if (isJunctionOrSymlink(linkPath)) {
      // Already a link — remove and re-create to ensure it points to the right place
      fs.rmSync(linkPath, { recursive: true, force: true });
    } else {
      // Plain directory — merge files into shared target first
      const existing = fs.readdirSync(linkPath);
      for (const file of existing) {
        const src = path.join(linkPath, file);
        const dest = path.join(targetDir, file);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
        }
      }
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
  }

  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(targetDir, linkPath, linkType);
}

/**
 * Remove the junction/symlink at `linkPath` and restore a plain directory
 * (copying back files from `targetDir` if it still exists).
 */
function removeLink(targetDir: string, linkPath: string): void {
  if (!isJunctionOrSymlink(linkPath)) return;

  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.mkdirSync(linkPath, { recursive: true });

  if (fs.existsSync(targetDir)) {
    for (const file of fs.readdirSync(targetDir)) {
      const src = path.join(targetDir, file);
      const dest = path.join(linkPath, file);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
      }
    }
  }
}

// ── Core sync / unsync ────────────────────────────────────────────────────────

export interface SyncOptions {
  /** Whether to sync the shared CLAUDE.md. Defaults to current manifest value or false. */
  claudeMd?: boolean;
  /** Whether to link memory/ to shared/memory/. Defaults to current manifest value or false. */
  memory?: boolean;
  /** Whether to link projects/ to shared/projects/. Defaults to current manifest value or false. */
  projects?: boolean;
}

/**
 * Apply or re-apply the shared layer to a profile config directory.
 * - Merges shared `settings.json` mcpServers into the profile's `settings.json`
 *   (profile-specific keys win on conflict).
 * - Copies commands from `shared/commands/` that don't already exist in the profile.
 * - Optionally prepends `shared/CLAUDE.md` to the profile's CLAUDE.md.
 * - Optionally links `profile/memory/` → `shared/memory/`.
 * - Optionally links `profile/projects/` → `shared/projects/`.
 * - Writes a manifest so the operation can be cleanly reversed or re-synced.
 */
export function syncSharedToProfile(
  profileConfigDir: string,
  opts: SyncOptions = {},
  targetTool?: string
): { warning?: string } {
  const sharedSettings = getSharedSettings();
  const sharedCommandsDir = getSharedCommandsDir();
  const existingManifest = getSharedManifest(profileConfigDir);
  const prevMcpKeys = new Set(existingManifest?.mcpServers ?? []);
  const prevCommands = new Set(existingManifest?.commands ?? []);

  // Resolve opt flags — if not explicitly provided, preserve current manifest state
  const syncClaudeMdFlag =
    opts.claudeMd !== undefined ? opts.claudeMd : (existingManifest?.claudeMd ?? false);
  const syncMemoryFlag =
    opts.memory !== undefined ? opts.memory : (existingManifest?.memoryLinked ?? false);
  const syncProjectsFlag =
    opts.projects !== undefined ? opts.projects : (existingManifest?.projectsLinked ?? false);

  const syncedMcpKeys: string[] = [];
  const syncedCommands: string[] = [];

  // ── settings.json / mcpServers ──────────────────────────────────────────
  const settingsPath = path.join(profileConfigDir, "settings.json");
  const profileSettings = readJson(settingsPath) ?? {};
  const mcpServers = (profileSettings["mcpServers"] ?? {}) as Record<string, unknown>;

  if (sharedSettings) {
    // Remove previously-synced keys so stale entries don't linger on re-sync
    for (const key of prevMcpKeys) {
      delete mcpServers[key];
    }

    const sharedMcp = (sharedSettings["mcpServers"] ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(sharedMcp)) {
      // Only inject if the profile doesn't have its own entry for this key
      if (!(key in mcpServers)) {
        mcpServers[key] = value;
      }
      syncedMcpKeys.push(key);
    }

    // Merge remaining top-level shared keys (profile wins on conflict)
    const merged: Record<string, unknown> = { ...sharedSettings, ...profileSettings };
    merged["mcpServers"] = mcpServers;

    fs.mkdirSync(profileConfigDir, { recursive: true });
    writeJson(settingsPath, merged);
  } else if (prevMcpKeys.size > 0) {
    // Shared settings were removed — clean up previously-synced MCP keys
    for (const key of prevMcpKeys) {
      delete mcpServers[key];
    }
    profileSettings["mcpServers"] = mcpServers;
    writeJson(settingsPath, profileSettings);
  }

  // ── commands/ ──────────────────────────────────────────────────────────
  if (fs.existsSync(sharedCommandsDir)) {
    const profileCommandsDir = path.join(profileConfigDir, "commands");
    fs.mkdirSync(profileCommandsDir, { recursive: true });

    const sharedFiles = new Set(fs.readdirSync(sharedCommandsDir));

    // Remove previously-synced commands that are no longer in shared
    for (const file of prevCommands) {
      if (!sharedFiles.has(file)) {
        const dest = path.join(profileCommandsDir, file);
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
      }
    }

    for (const file of sharedFiles) {
      const dest = path.join(profileCommandsDir, file);
      // Copy if: not present, or was previously synced from shared (update it)
      if (!fs.existsSync(dest) || prevCommands.has(file)) {
        fs.copyFileSync(path.join(sharedCommandsDir, file), dest);
        syncedCommands.push(file);
      }
    }
  } else if (prevCommands.size > 0) {
    // shared/commands/ removed — clean up
    const profileCommandsDir = path.join(profileConfigDir, "commands");
    for (const file of prevCommands) {
      const dest = path.join(profileCommandsDir, file);
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    }
  }

  // ── CLAUDE.md ──────────────────────────────────────────────────────────
  let claudeMdSynced = false;
  if (syncClaudeMdFlag) {
    claudeMdSynced = syncClaudeMd(profileConfigDir);
  } else if (existingManifest?.claudeMd) {
    // Was previously enabled but now disabled — clean up
    unsyncClaudeMd(profileConfigDir);
  }

  // ── memory/ ────────────────────────────────────────────────────────────
  const memoryLinkPath = path.join(profileConfigDir, "memory");
  if (syncMemoryFlag) {
    createLink(getSharedMemoryDir(), memoryLinkPath);
  } else if (existingManifest?.memoryLinked) {
    // Was previously linked but now disabled — restore plain dir
    removeLink(getSharedMemoryDir(), memoryLinkPath);
  }

  // ── projects/ ──────────────────────────────────────────────────────────
  const projectsLinkPath = path.join(profileConfigDir, "projects");
  if (syncProjectsFlag) {
    createLink(getSharedProjectsDir(), projectsLinkPath);
  } else if (existingManifest?.projectsLinked) {
    // Was previously linked but now disabled — restore plain dir
    removeLink(getSharedProjectsDir(), projectsLinkPath);
  }

  writeJson(path.join(profileConfigDir, MANIFEST_FILE), {
    syncedAt: new Date().toISOString(),
    mcpServers: syncedMcpKeys,
    commands: syncedCommands,
    claudeMd: claudeMdSynced,
    memoryLinked: syncMemoryFlag,
    projectsLinked: syncProjectsFlag,
  } satisfies SharedManifest);

  // Check for cross-tool mismatch
  const sourceTool = getSharedSourceTool();
  if (targetTool && sourceTool && targetTool !== sourceTool && syncedMcpKeys.length > 0) {
    return {
      warning: `Shared layer was configured for ${sourceTool} — MCP server config may not be compatible with ${targetTool}.`,
    };
  }

  return {};
}

/**
 * Remove the shared layer from a profile config directory, leaving only
 * profile-specific settings intact.
 */
export function unsyncSharedFromProfile(profileConfigDir: string): void {
  const manifest = getSharedManifest(profileConfigDir);
  if (!manifest) return;

  // Remove shared MCP keys from settings.json
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

  // Remove synced command files
  const profileCommandsDir = path.join(profileConfigDir, "commands");
  for (const file of manifest.commands) {
    const dest = path.join(profileCommandsDir, file);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  }

  // Remove shared CLAUDE.md block
  if (manifest.claudeMd) {
    unsyncClaudeMd(profileConfigDir);
  }

  // Restore memory/ from junction/symlink to plain dir
  if (manifest.memoryLinked) {
    removeLink(getSharedMemoryDir(), path.join(profileConfigDir, "memory"));
  }

  // Restore projects/ from junction/symlink to plain dir
  if (manifest.projectsLinked) {
    removeLink(getSharedProjectsDir(), path.join(profileConfigDir, "projects"));
  }

  const manifestPath = path.join(profileConfigDir, MANIFEST_FILE);
  if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
}

// ── Pull: profile → shared layer ──────────────────────────────────────────

export interface PullResult {
  mcpServers: string[];
  commands: string[];
  claudeMd: boolean;
}

/**
 * Pull a profile's MCP servers, commands, and CLAUDE.md into the shared layer.
 * This makes the profile's config available to all other profiles that enable sharing.
 */
export function pullProfileToShared(profileConfigDir: string, sourceTool?: string): PullResult {
  const sharedDir = path.dirname(getSharedSettingsPath());
  fs.mkdirSync(sharedDir, { recursive: true });

  const result: PullResult = { mcpServers: [], commands: [], claudeMd: false };

  // ── MCP servers from profile settings.json ──
  const profileSettings = readJson(path.join(profileConfigDir, "settings.json"));
  if (profileSettings) {
    const mcpServers = (profileSettings["mcpServers"] ?? {}) as Record<string, unknown>;
    const keys = Object.keys(mcpServers);
    if (keys.length > 0) {
      // Merge into shared settings (preserving any existing non-MCP keys)
      const sharedSettings = readJson(getSharedSettingsPath()) ?? {};
      const existing = (sharedSettings["mcpServers"] ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(mcpServers)) {
        existing[key] = value;
      }
      sharedSettings["mcpServers"] = existing;
      if (sourceTool) {
        sharedSettings["_sourceTool"] = sourceTool;
      }
      writeJson(getSharedSettingsPath(), sharedSettings);
      result.mcpServers = keys;
    }
  }

  // ── Commands directory ──
  const profileCommandsDir = path.join(profileConfigDir, "commands");
  if (fs.existsSync(profileCommandsDir)) {
    const commandsDir = getSharedCommandsDir();
    fs.mkdirSync(commandsDir, { recursive: true });
    const files = fs.readdirSync(profileCommandsDir).filter((f) => !f.startsWith("."));
    for (const file of files) {
      fs.copyFileSync(
        path.join(profileCommandsDir, file),
        path.join(commandsDir, file)
      );
      result.commands.push(file);
    }
  }

  // ── CLAUDE.md ──
  const profileClaudeMd = path.join(profileConfigDir, "CLAUDE.md");
  if (fs.existsSync(profileClaudeMd)) {
    const content = fs.readFileSync(profileClaudeMd, "utf-8").trim();
    // Strip any existing shared block markers before copying
    const cleaned = content
      .replace(new RegExp(`${CLAUDE_MD_START}[\\s\\S]*?${CLAUDE_MD_END}`, "g"), "")
      .trim();
    if (cleaned) {
      fs.writeFileSync(getSharedClaudeMdPath(), cleaned + "\n", "utf-8");
      result.claudeMd = true;
    }
  }

  return result;
}
