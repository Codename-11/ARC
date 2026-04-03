import fs from "node:fs";
import path from "node:path";
import { getSharedClaudeMdPath, getSharedCommandsDir, getSharedSettingsPath } from "./paths.js";
import {
  getSharedManifest,
  pullProfileIntoShared,
  syncSharedLayer,
  unsyncSharedLayer,
  type SharedLayerPullResult,
  type SharedLayerSyncOptions,
} from "./shared-layer.js";
import type { SharedManifest } from "./types.js";

// ── CLAUDE.md sentinel helpers ────────────────────────────────────────────
const CLAUDE_MD_START = "<!-- arc:shared:start -->";
const CLAUDE_MD_END = "<!-- arc:shared:end -->";

function removeSharedClaudeMdBlock(content: string): string {
  const startIdx = content.indexOf(CLAUDE_MD_START);
  const endIdx = content.indexOf(CLAUDE_MD_END);
  if (startIdx === -1 || endIdx === -1) return content;
  const afterEnd = endIdx + CLAUDE_MD_END.length;
  const tail = content.slice(afterEnd).replace(/^\n/, "");
  return (content.slice(0, startIdx) + tail).trimStart();
}

function syncClaudeMd(profileConfigDir: string): boolean {
  const sharedPath = getSharedClaudeMdPath();
  if (!fs.existsSync(sharedPath)) return false;

  const sharedContent = fs.readFileSync(sharedPath, "utf-8").trim();
  if (!sharedContent) return false;

  const profileClaudeMdPath = path.join(profileConfigDir, "CLAUDE.md");
  const existingContent = fs.existsSync(profileClaudeMdPath)
    ? fs.readFileSync(profileClaudeMdPath, "utf-8")
    : "";

  const stripped = removeSharedClaudeMdBlock(existingContent);

  const injected =
    `${CLAUDE_MD_START}\n${sharedContent}\n${CLAUDE_MD_END}\n` +
    (stripped ? `\n${stripped}` : "");

  fs.mkdirSync(profileConfigDir, { recursive: true });
  fs.writeFileSync(profileClaudeMdPath, injected, "utf-8");
  return true;
}

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

// ── Shared helpers (re-used in read-json) ──────────────────────────────────
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

// ── Public types ───────────────────────────────────────────────────────────
export interface PullResult {
  mcpServers: string[];
  commands: string[];
  claudeMd: boolean;
}

// ── Public API ─────────────────────────────────────────────────────────────

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
    claudeMd?: boolean;
    memory?: boolean;
    projects?: boolean;
    artifactMode?: "sync" | "unsync" | "preserve";
    adapterArtifactSync?: (() => string[]) | undefined;
    targetTool?: string;
  } = {},
  targetTool?: string
): { warning?: string; manifest: SharedManifest } {
  const existingManifest = getSharedManifest(profileConfigDir);

  // Resolve claudeMd flag — preserve manifest state if not explicitly provided
  const syncClaudeMdFlag =
    opts.claudeMd !== undefined ? opts.claudeMd : ((existingManifest as Record<string, unknown> | null)?.["claudeMd"] === true);

  const syncOpts: SharedLayerSyncOptions = {
    memory: opts.memory,
    projects: opts.projects,
    adapterArtifactSync: opts.adapterArtifactSync,
  };
  const manifest = syncSharedLayer(profileConfigDir, syncOpts);

  // Handle CLAUDE.md sync
  if (syncClaudeMdFlag) {
    syncClaudeMd(profileConfigDir);
  } else if ((existingManifest as Record<string, unknown> | null)?.["claudeMd"] === true) {
    unsyncClaudeMd(profileConfigDir);
  }

  // Check for cross-tool mismatch
  const sourceTool = getSharedSourceTool();
  const effectiveTool = targetTool ?? opts.targetTool;
  if (effectiveTool && sourceTool && effectiveTool !== sourceTool && manifest.mcpServers.length > 0) {
    return {
      warning: `Shared layer was configured for ${sourceTool} — MCP server config may not be compatible with ${effectiveTool}.`,
      manifest,
    };
  }

  return { manifest };
}

export function unsyncSharedFromProfile(
  profileConfigDir: string,
  removeAdapterArtifacts?: () => void
): void {
  unsyncSharedLayer(profileConfigDir, removeAdapterArtifacts);
}

export function pullProfileToShared(
  profileConfigDir: string,
  sourceTool?: string
): PullResult {
  const baseResult = pullProfileIntoShared(profileConfigDir);

  const result: PullResult = {
    mcpServers: baseResult.mcpServers,
    commands: baseResult.commands,
    claudeMd: false,
  };

  // Tag _sourceTool in shared settings if provided and MCP servers were pulled
  if (sourceTool && baseResult.mcpServers.length > 0) {
    const sharedSettings = readJson(getSharedSettingsPath()) ?? {};
    sharedSettings["_sourceTool"] = sourceTool;
    writeJson(getSharedSettingsPath(), sharedSettings);
  }

  // Copy CLAUDE.md to shared layer
  const profileClaudeMd = path.join(profileConfigDir, "CLAUDE.md");
  if (fs.existsSync(profileClaudeMd)) {
    const content = fs.readFileSync(profileClaudeMd, "utf-8").trim();
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

export { syncSharedLayer, unsyncSharedLayer, pullProfileIntoShared };
export type { SharedManifest };
