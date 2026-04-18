import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig } from "../config.js";
import { getProfileDir } from "../paths.js";
import type { Profile } from "@axiom-labs/arc-core";
import { success, error, info, warn } from "../display.js";

/**
 * On-disk format for `arc profile export`.
 *
 * Version 1 inlines the referenced `instructionsFile` (when present) so that
 * imports on other machines don't rely on that path existing.
 */
export interface ProfileExportManifest {
  manifest: "arc-profile-export";
  manifestVersion: 1;
  exportedAt: string;
  arcVersion?: string;
  name: string;
  profile: Profile;
  /** Verbatim contents of profile.instructionsFile, if it existed on disk. */
  instructionsContent?: string;
}

const MANIFEST_KIND = "arc-profile-export";
const MANIFEST_VERSION: 1 = 1;

function slugify(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "profile";
}

export async function handleProfileExport(
  name: string,
  opts: { out?: string },
): Promise<void> {
  const config = loadConfig();
  const profile = config.profiles[name];
  if (!profile) {
    error(`Profile "${name}" not found.`);
    process.exit(1);
  }

  // Deep-clone so we don't mutate the in-memory config.
  const profileCopy: Profile = JSON.parse(JSON.stringify(profile));

  let instructionsContent: string | undefined;
  if (profileCopy.instructionsFile) {
    try {
      instructionsContent = fs.readFileSync(profileCopy.instructionsFile, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warn(`Could not inline instructions file "${profileCopy.instructionsFile}": ${msg}`);
    }
  }

  let arcVersion: string | undefined;
  try {
    const mod = await import("../version.js");
    arcVersion = mod.VERSION;
  } catch {
    // Optional — continue without.
  }

  const manifest: ProfileExportManifest = {
    manifest: MANIFEST_KIND,
    manifestVersion: MANIFEST_VERSION,
    exportedAt: new Date().toISOString(),
    arcVersion,
    name,
    profile: profileCopy,
    ...(instructionsContent !== undefined ? { instructionsContent } : {}),
  };

  const outPath =
    opts.out !== undefined
      ? path.resolve(opts.out)
      : path.resolve(`./${slugify(name)}.arc-profile.json`);

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Failed to write "${outPath}": ${msg}`);
    process.exit(1);
  }

  success(`Exported profile "${name}" to ${outPath}`);
  if (instructionsContent !== undefined) {
    info(`Inlined instructions file (${instructionsContent.length} chars).`);
  }
}

function isValidManifest(value: unknown): value is ProfileExportManifest {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  if (m["manifest"] !== MANIFEST_KIND) return false;
  if (typeof m["manifestVersion"] !== "number") return false;
  if (typeof m["name"] !== "string") return false;
  if (typeof m["profile"] !== "object" || m["profile"] === null) return false;
  const p = m["profile"] as Record<string, unknown>;
  if (typeof p["authType"] !== "string") return false;
  if (typeof p["configDir"] !== "string") return false;
  if (typeof p["createdAt"] !== "string") return false;
  return true;
}

export async function handleProfileImport(
  file: string,
  opts: { as?: string; force?: boolean },
): Promise<void> {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) {
    error(`File not found: ${resolved}`);
    process.exit(1);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(resolved, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Failed to read "${resolved}": ${msg}`);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Invalid JSON in "${resolved}": ${msg}`);
    process.exit(1);
  }

  if (!isValidManifest(parsed)) {
    error(`File "${resolved}" is not a valid ARC profile export (manifest check failed).`);
    process.exit(1);
  }

  const manifest: ProfileExportManifest = parsed;

  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    error(
      `Unsupported manifest version ${manifest.manifestVersion}. This ARC build supports version ${MANIFEST_VERSION}.`,
    );
    process.exit(1);
  }

  const targetName = opts.as ?? manifest.name;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(targetName)) {
    error(`Invalid profile name: "${targetName}".`);
    process.exit(1);
  }

  const config = loadConfig();
  const exists = Object.prototype.hasOwnProperty.call(config.profiles, targetName);

  if (exists && !opts.force && !opts.as) {
    error(`Profile "${targetName}" already exists. Pass --force to overwrite or --as <newname> to rename.`);
    process.exit(1);
  }
  if (exists && opts.as) {
    // User explicitly renamed but collided with something else.
    if (!opts.force) {
      error(`Profile "${targetName}" (from --as) already exists. Pass --force to overwrite.`);
      process.exit(1);
    }
  }

  // Clone, then optionally re-target configDir and instructionsFile to the new name.
  const imported: Profile = JSON.parse(JSON.stringify(manifest.profile));

  // If the profile had inline instructions content, write it into the new profile's dir.
  if (manifest.instructionsContent !== undefined) {
    const profileDir = getProfileDir(targetName);
    fs.mkdirSync(profileDir, { recursive: true });
    const instructionsPath = path.join(profileDir, "instructions.md");
    try {
      fs.writeFileSync(instructionsPath, manifest.instructionsContent, "utf-8");
      imported.instructionsFile = instructionsPath;
      delete imported.instructions;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warn(`Failed to write instructions to "${instructionsPath}": ${msg}`);
    }
  } else if (imported.instructionsFile && opts.as) {
    // Renamed on import — the old instructionsFile path likely points at a
    // foreign profile dir. Keep it as-is but warn.
    warn(
      `Profile references instructionsFile "${imported.instructionsFile}" — verify it exists on this machine.`,
    );
  }

  // Reset configDir to a fresh per-profile dir (do not reuse the source machine's path).
  imported.configDir = getProfileDir(targetName);
  fs.mkdirSync(imported.configDir, { recursive: true });

  config.profiles[targetName] = imported;
  if (!config.activeProfile) {
    config.activeProfile = targetName;
  }
  saveConfig(config);

  success(
    exists
      ? `Overwrote profile "${targetName}" from ${resolved}`
      : `Imported profile "${targetName}" from ${resolved}`,
  );
  if (manifest.instructionsContent !== undefined) {
    info(`Wrote instructions to ${imported.instructionsFile}`);
  }
}
