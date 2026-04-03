/**
 * Credential hot-swap — experimental feature.
 *
 * Swaps only the auth credential file in the tool's canonical config directory
 * while preserving MCPs, settings, session history, etc.
 *
 * Credential snapshots are stored in ~/.arc/credentials/<account-name>/
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { getArcDir } from "./paths.js";
import { logAction } from "./log.js";

// ── Paths ─────────────────────────────────────────────────────────────

function getCredentialsDir(): string {
  return path.join(getArcDir(), "credentials");
}

function getAccountDir(account: string): string {
  return path.join(getCredentialsDir(), account);
}

/** Map of tool → canonical config dir */
const TOOL_CONFIG_DIRS: Record<string, string> = {
  claude: path.join(os.homedir(), ".claude"),
  gemini: path.join(os.homedir(), ".gemini"),
  codex: path.join(os.homedir(), ".codex"),
};

/** Map of tool → credential file name */
const TOOL_CREDENTIAL_FILES: Record<string, string[]> = {
  claude: [".credentials.json"],
  gemini: ["oauth_creds.json", "google_accounts.json"],
  codex: ["auth.json"],
};

// ── Types ─────────────────────────────────────────────────────────────

export interface SwapAccountMeta {
  tier?: string;
  subscription?: string;
}

export interface SwapAccount {
  name: string;
  tool: string;
  isActive: boolean;
  createdAt: string;
  meta?: SwapAccountMeta;
}

interface SwapManifest {
  accounts: Record<string, { tool: string; createdAt: string; meta?: SwapAccountMeta }>;
  active: Record<string, string>; // tool → active account name
}

// ── Manifest ──────────────────────────────────────────────────────────

function manifestPath(): string {
  return path.join(getCredentialsDir(), "swap-manifest.json");
}

function loadManifest(): SwapManifest {
  try {
    const raw = fs.readFileSync(manifestPath(), "utf-8");
    return JSON.parse(raw) as SwapManifest;
  } catch {
    return { accounts: {}, active: {} };
  }
}

function saveManifest(manifest: SwapManifest): void {
  const dir = getCredentialsDir();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = manifestPath() + `.tmp.${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf-8");
  fs.renameSync(tmp, manifestPath());
}

// ── Metadata extraction ──────────────────────────────────────────────

/**
 * Read the credential file for a tool and extract identifying metadata.
 */
function extractCredentialMeta(tool: string, configDir: string): SwapAccountMeta | undefined {
  try {
    if (tool === "claude") {
      const credPath = path.join(configDir, ".credentials.json");
      if (!fs.existsSync(credPath)) return undefined;
      const raw = JSON.parse(fs.readFileSync(credPath, "utf-8")) as Record<string, unknown>;
      const oauth = raw["claudeAiOauth"] as Record<string, unknown> | undefined;
      if (!oauth) return undefined;
      const meta: SwapAccountMeta = {};
      if (typeof oauth["rateLimitTier"] === "string") meta.tier = oauth["rateLimitTier"];
      if (typeof oauth["subscriptionType"] === "string") meta.subscription = oauth["subscriptionType"];
      return (meta.tier || meta.subscription) ? meta : undefined;
    }
  } catch {
    // Best-effort metadata extraction — non-critical
  }
  return undefined;
}

// ── Core operations ───────────────────────────────────────────────────

/**
 * Capture the current credentials from a tool's canonical config dir
 * and store them as a named account snapshot.
 */
export function captureAccount(
  accountName: string,
  tool: string
): { ok: true } | { ok: false; error: string } {
  const configDir = TOOL_CONFIG_DIRS[tool];
  if (!configDir) return { ok: false, error: `Unknown tool: ${tool}` };

  const credFiles = TOOL_CREDENTIAL_FILES[tool] ?? [];
  if (credFiles.length === 0) return { ok: false, error: `No credential files defined for ${tool}` };

  // Verify at least one credential file exists
  const existing = credFiles.filter((f) => fs.existsSync(path.join(configDir, f)));
  if (existing.length === 0) {
    return { ok: false, error: `No credentials found in ${configDir}. Authenticate with ${tool} first.` };
  }

  const accountDir = getAccountDir(accountName);
  fs.mkdirSync(accountDir, { recursive: true });

  // Copy credential files to snapshot
  for (const f of existing) {
    fs.copyFileSync(path.join(configDir, f), path.join(accountDir, f));
    fs.chmodSync(path.join(accountDir, f), 0o600);
  }

  // Extract metadata from credential files
  const meta = extractCredentialMeta(tool, configDir);

  // Update manifest
  const manifest = loadManifest();
  manifest.accounts[accountName] = { tool, createdAt: new Date().toISOString(), meta };
  manifest.active[tool] = accountName;
  saveManifest(manifest);

  logAction("swap:capture", `${accountName} (${tool})`);
  return { ok: true };
}

/**
 * Swap credentials: save current credentials as the active account,
 * then restore the target account's credentials into the canonical dir.
 *
 * Safety: validates target snapshot exists before touching current credentials.
 * If restore fails, rolls back by re-copying the saved current credentials.
 */
export function swapTo(
  accountName: string
): { ok: true; tool: string } | { ok: false; error: string } {
  const manifest = loadManifest();
  const account = manifest.accounts[accountName];
  if (!account) return { ok: false, error: `Account "${accountName}" not found. Run capture first.` };

  const { tool } = account;
  const configDir = TOOL_CONFIG_DIRS[tool];
  if (!configDir) return { ok: false, error: `Unknown tool: ${tool}` };

  const credFiles = TOOL_CREDENTIAL_FILES[tool] ?? [];
  const accountDir = getAccountDir(accountName);

  // Pre-flight: verify target snapshot has at least one credential file
  const targetFiles = credFiles.filter((f) => fs.existsSync(path.join(accountDir, f)));
  if (targetFiles.length === 0) {
    return { ok: false, error: `Account "${accountName}" snapshot is empty or corrupted.` };
  }

  // Save current credentials as the currently-active account (if any)
  const currentActive = manifest.active[tool];
  const savedCurrent: Array<{ file: string; content: Buffer }> = [];
  if (currentActive && currentActive !== accountName) {
    const currentDir = getAccountDir(currentActive);
    fs.mkdirSync(currentDir, { recursive: true });
    for (const f of credFiles) {
      const src = path.join(configDir, f);
      if (fs.existsSync(src)) {
        const content = fs.readFileSync(src);
        savedCurrent.push({ file: f, content });
        fs.copyFileSync(src, path.join(currentDir, f));
      }
    }
  }

  // Restore target account's credentials into canonical dir
  try {
    for (const f of targetFiles) {
      fs.copyFileSync(path.join(accountDir, f), path.join(configDir, f));
      fs.chmodSync(path.join(configDir, f), 0o600);
    }
  } catch (err) {
    // Rollback: restore saved current credentials
    for (const { file, content } of savedCurrent) {
      try {
        fs.writeFileSync(path.join(configDir, file), content);
      } catch {
        // Best-effort rollback
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Swap failed, rolled back: ${msg}` };
  }

  // Update active (after successful swap)
  manifest.active[tool] = accountName;
  saveManifest(manifest);

  logAction("swap:to", `${accountName} (${tool})`);
  return { ok: true, tool };
}

/**
 * List all captured accounts.
 */
export function listAccounts(): SwapAccount[] {
  const manifest = loadManifest();
  return Object.entries(manifest.accounts).map(([name, info]) => ({
    name,
    tool: info.tool,
    isActive: manifest.active[info.tool] === name,
    createdAt: info.createdAt,
    meta: info.meta,
  }));
}

/**
 * Return per-tool active account status.
 */
export function swapStatus(): Array<{ tool: string; account: string | null; meta?: SwapAccountMeta }> {
  const manifest = loadManifest();
  const tools = Object.keys(TOOL_CONFIG_DIRS);
  return tools.map((tool) => {
    const active = manifest.active[tool] ?? null;
    const meta = active ? manifest.accounts[active]?.meta : undefined;
    return { tool, account: active, meta };
  });
}

/**
 * Delete a captured account snapshot.
 */
export function deleteAccount(
  accountName: string
): { ok: true } | { ok: false; error: string } {
  const manifest = loadManifest();
  if (!manifest.accounts[accountName]) {
    return { ok: false, error: `Account "${accountName}" not found.` };
  }

  const tool = manifest.accounts[accountName]!.tool;

  // Don't allow deleting the currently active account
  if (manifest.active[tool] === accountName) {
    return { ok: false, error: `Cannot delete the active account. Swap to another account first.` };
  }

  // Remove snapshot directory
  const accountDir = getAccountDir(accountName);
  fs.rmSync(accountDir, { recursive: true, force: true });

  // Remove from manifest
  delete manifest.accounts[accountName];
  saveManifest(manifest);

  return { ok: true };
}

// ── Profile bridge ───────────────────────────────────────────────────

/** Supported tools for swap operations. */
export const SWAP_TOOLS = Object.keys(TOOL_CONFIG_DIRS);

/**
 * Swap to the credentials from an ARC profile's configDir.
 * This bridges the profile system (env var isolation) with the swap system
 * (canonical dir replacement) for desktop apps.
 */
export function swapFromProfile(
  profileName: string,
  profileConfigDir: string,
  tool: string
): { ok: true } | { ok: false; error: string } {
  const canonicalDir = TOOL_CONFIG_DIRS[tool];
  if (!canonicalDir) return { ok: false, error: `Unknown tool: ${tool}` };

  const credFiles = TOOL_CREDENTIAL_FILES[tool] ?? [];
  if (credFiles.length === 0) return { ok: false, error: `No credential files defined for ${tool}` };

  // Find credential files in the profile's configDir
  const existing = credFiles.filter((f) => fs.existsSync(path.join(profileConfigDir, f)));
  if (existing.length === 0) {
    return {
      ok: false,
      error: `No ${tool} credentials found in profile "${profileName}" (${profileConfigDir}). Authenticate first.`,
    };
  }

  // Ensure canonical dir exists
  fs.mkdirSync(canonicalDir, { recursive: true });

  // Copy credential files from profile configDir to canonical dir
  for (const f of existing) {
    fs.copyFileSync(path.join(profileConfigDir, f), path.join(canonicalDir, f));
    fs.chmodSync(path.join(canonicalDir, f), 0o600);
  }

  // Update manifest to show this profile as active (no snapshot created)
  const manifest = loadManifest();
  manifest.active[tool] = `profile:${profileName}`;
  saveManifest(manifest);

  logAction("swap:from-profile", `${profileName} → ${tool}`);
  return { ok: true };
}
