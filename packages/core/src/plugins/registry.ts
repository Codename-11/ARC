// ---------------------------------------------------------------------------
// Phase 23 — Plugin Registry (JSON file-backed)
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getArcDir } from "../paths.js";
import { writeLogEvent } from "../logging.js";
import type { InstalledPlugin, PluginManifest } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pluginsDir(): string {
  return path.join(getArcDir(), "plugins");
}

function installedJsonPath(): string {
  return path.join(pluginsDir(), "installed.json");
}

function readRegistry(): InstalledPlugin[] {
  try {
    const raw = fs.readFileSync(installedJsonPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as InstalledPlugin[]) : [];
  } catch {
    return [];
  }
}

function writeRegistry(plugins: InstalledPlugin[]): void {
  const dir = pluginsDir();
  fs.mkdirSync(dir, { recursive: true });

  const tempPath = path.join(dir, `installed.tmp.${crypto.randomBytes(4).toString("hex")}`);
  fs.writeFileSync(tempPath, JSON.stringify(plugins, null, 2) + "\n", "utf-8");
  fs.renameSync(tempPath, installedJsonPath());
}

/**
 * Minimal semver-range compatibility check.
 *
 * Supports exact match ("1.2.3") and caret ranges ("^1.2.0").
 * For anything more complex, callers should use a proper semver library;
 * this keeps the core dependency-free.
 */
function semverSatisfies(version: string, range: string): boolean {
  const parseSemver = (v: string): [number, number, number] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };

  const ver = parseSemver(version);
  if (!ver) return false;

  // Caret range: ^MAJOR.MINOR.PATCH
  if (range.startsWith("^")) {
    const req = parseSemver(range.slice(1));
    if (!req) return false;

    // Same major, and version >= range floor
    if (ver[0] !== req[0]) return false;
    if (ver[1] > req[1]) return true;
    if (ver[1] === req[1] && ver[2] >= req[2]) return true;
    return false;
  }

  // Exact match fallback.
  const req = parseSemver(range);
  if (!req) return false;
  return ver[0] === req[0] && ver[1] === req[1] && ver[2] === req[2];
}

// ---------------------------------------------------------------------------
// PluginRegistry
// ---------------------------------------------------------------------------

export class PluginRegistry {
  // ---- Public API ---------------------------------------------------------

  /**
   * Install a plugin from the given path.  Reads `plugin.json` from the
   * source directory, validates the manifest, and copies the plugin into
   * `~/.arc/plugins/<name>/`.
   */
  install(pluginPath: string): InstalledPlugin {
    const manifestPath = path.join(pluginPath, "plugin.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`No plugin.json found at ${pluginPath}`);
    }

    let manifest: PluginManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as PluginManifest;
    } catch {
      throw new Error(`Failed to parse plugin.json at ${manifestPath}`);
    }

    this.validateManifest(manifest);

    // Prevent duplicate installs.
    const existing = readRegistry();
    if (existing.some((p) => p.manifest.name === manifest.name)) {
      throw new Error(`Plugin '${manifest.name}' is already installed`);
    }

    // Copy plugin into the managed directory.
    const destDir = path.join(pluginsDir(), manifest.name);
    fs.mkdirSync(destDir, { recursive: true });
    this.copyDirSync(pluginPath, destDir);

    const entry: InstalledPlugin = {
      manifest,
      path: destDir,
      enabled: true,
      installedAt: new Date().toISOString(),
    };

    existing.push(entry);
    writeRegistry(existing);

    writeLogEvent({
      level: "info",
      component: "plugin",
      action: "install",
      message: `Installed plugin '${manifest.name}' v${manifest.version}`,
      data: { name: manifest.name, version: manifest.version },
    });

    return entry;
  }

  /** Uninstall a plugin by name — removes its directory and registry entry. */
  uninstall(name: string): void {
    const plugins = readRegistry();
    const index = plugins.findIndex((p) => p.manifest.name === name);
    if (index === -1) {
      throw new Error(`Plugin '${name}' is not installed`);
    }

    const removed = plugins.splice(index, 1)[0];

    // Remove the plugin directory.
    try {
      fs.rmSync(removed.path, { recursive: true, force: true });
    } catch {
      // Best-effort removal.
    }

    writeRegistry(plugins);

    writeLogEvent({
      level: "info",
      component: "plugin",
      action: "uninstall",
      message: `Uninstalled plugin '${name}'`,
    });
  }

  /** Return all installed plugins. */
  list(): InstalledPlugin[] {
    return readRegistry();
  }

  /** Get a single installed plugin by name. */
  get(name: string): InstalledPlugin | undefined {
    return readRegistry().find((p) => p.manifest.name === name);
  }

  /** Enable a previously disabled plugin. */
  enable(name: string): void {
    this.setEnabled(name, true);
  }

  /** Disable a plugin without uninstalling it. */
  disable(name: string): void {
    this.setEnabled(name, false);
  }

  /**
   * Check whether a plugin manifest is compatible with the given ARC version.
   */
  isCompatible(manifest: PluginManifest, arcVersion: string): boolean {
    return semverSatisfies(arcVersion, manifest.compatibility.arc);
  }

  // ---- Internals ----------------------------------------------------------

  private validateManifest(manifest: PluginManifest): void {
    if (!manifest.name || typeof manifest.name !== "string") {
      throw new Error("Plugin manifest must include a 'name' (string)");
    }
    if (!manifest.version || typeof manifest.version !== "string") {
      throw new Error("Plugin manifest must include a 'version' (string)");
    }
    if (!manifest.description || typeof manifest.description !== "string") {
      throw new Error("Plugin manifest must include a 'description' (string)");
    }
    if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
      throw new Error("Plugin manifest must include at least one capability");
    }
    if (
      !manifest.compatibility ||
      typeof manifest.compatibility.arc !== "string"
    ) {
      throw new Error("Plugin manifest must include compatibility.arc (semver range)");
    }
  }

  private setEnabled(name: string, enabled: boolean): void {
    const plugins = readRegistry();
    const plugin = plugins.find((p) => p.manifest.name === name);
    if (!plugin) {
      throw new Error(`Plugin '${name}' is not installed`);
    }

    plugin.enabled = enabled;
    writeRegistry(plugins);

    writeLogEvent({
      level: "info",
      component: "plugin",
      action: enabled ? "enable" : "disable",
      message: `Plugin '${name}' ${enabled ? "enabled" : "disabled"}`,
    });
  }

  /** Recursively copy a directory (shallow clone). */
  private copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
