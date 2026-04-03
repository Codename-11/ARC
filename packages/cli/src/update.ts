import fs from "node:fs";
import path from "node:path";
import { VERSION } from "./version.js";
import { getArcDir } from "./paths.js";

// Package name must match what we actually publish to npm.
export const PACKAGE_NAME = "@axiom-labs/arc-cli";
const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/latest`;
const CACHE_FILE = "update-check.json";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface UpdateCache {
  latestVersion: string;
  checkedAt: number;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

function cacheFilePath(): string {
  return path.join(getArcDir(), CACHE_FILE);
}

function readCache(): UpdateCache | null {
  try {
    const raw = fs.readFileSync(cacheFilePath(), "utf-8");
    return JSON.parse(raw) as UpdateCache;
  } catch {
    return null;
  }
}

function writeCache(cache: UpdateCache): void {
  try {
    fs.writeFileSync(cacheFilePath(), JSON.stringify(cache), "utf-8");
  } catch {
    // Non-critical — silently ignore
  }
}

/**
 * Compare two semver-ish strings. Returns true if b > a.
 * Handles pre-release tags: 0.1.0-beta < 0.1.0 < 0.2.0
 */
function isNewer(current: string, latest: string): boolean {
  const normalize = (v: string) => v.replace(/^v/, "");
  const a = normalize(current);
  const b = normalize(latest);
  if (a === b) return false;

  const [aParts, aPre] = a.split("-");
  const [bParts, bPre] = b.split("-");
  const aSegs = (aParts ?? "").split(".").map(Number);
  const bSegs = (bParts ?? "").split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    if ((bSegs[i] ?? 0) > (aSegs[i] ?? 0)) return true;
    if ((bSegs[i] ?? 0) < (aSegs[i] ?? 0)) return false;
  }

  // Same numeric version — pre-release < release
  if (aPre && !bPre) return true;
  if (!aPre && bPre) return false;
  return false;
}

/**
 * Check npm registry for latest version. Uses a local cache to avoid
 * hammering the registry. Returns null if check fails or is cached.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  // Check cache first
  const cached = readCache();
  if (cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS) {
    return {
      current: VERSION,
      latest: cached.latestVersion,
      updateAvailable: isNewer(VERSION, cached.latestVersion),
    };
  }

  // Fetch from registry
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = (await res.json()) as { version?: string };
    const latest = data.version;
    if (!latest) return null;

    writeCache({ latestVersion: latest, checkedAt: Date.now() });

    return {
      current: VERSION,
      latest,
      updateAvailable: isNewer(VERSION, latest),
    };
  } catch {
    return null;
  }
}

/**
 * Run self-update via npm. Uses async exec to avoid blocking the event loop
 * (which would freeze the TUI).
 */
export async function runSelfUpdate(): Promise<{ ok: boolean; message: string }> {
  const { exec } = await import("node:child_process");

  try {
    await new Promise<void>((resolve, reject) => {
      const installCmd = process.platform === "win32"
        ? `cmd /c npm install -g ${PACKAGE_NAME}@latest`
        : `npm install -g ${PACKAGE_NAME}@latest`;
      const child = exec(installCmd, {
        timeout: 60_000,
      });
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`npm exited with code ${code}`));
      });
      child.on("error", reject);
    });

    // Re-check what version we got
    const info = await checkForUpdate();
    return {
      ok: true,
      message: info
        ? `Updated to v${info.latest}.`
        : "Update complete.",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Update failed: ${msg}\n\nTry manually: npm install -g ${PACKAGE_NAME}@latest`,
    };
  }
}
