import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getConfigPath, getArcDir } from "./paths.js";
import { deepMerge } from "@axiom-labs/arc-core";
import type { ArcConfig, Profile } from "./types.js";

const AUTH_TYPES = new Set(["oauth", "api-key", "bedrock", "vertex", "foundry"]);

function defaultConfig(): ArcConfig {
  return { version: 1, activeProfile: "default", profiles: {} };
}

export function validateConfig(config: unknown): config is ArcConfig {
  if (typeof config !== "object" || config === null) {
    return false;
  }
  const obj = config as Record<string, unknown>;
  if (obj["version"] !== 1) {
    return false;
  }
  if (typeof obj["activeProfile"] !== "string") {
    return false;
  }
  if (typeof obj["profiles"] !== "object" || obj["profiles"] === null) {
    return false;
  }
  const profiles = obj["profiles"] as Record<string, unknown>;
  for (const key of Object.keys(profiles)) {
    const p = profiles[key];
    if (typeof p !== "object" || p === null) {
      return false;
    }
    const profile = p as Record<string, unknown>;

    // Child profiles with an `inherits` field skip required-field checks;
    // the resolved profile is validated at resolution time.
    if (profile["inherits"] !== undefined) {
      if (typeof profile["inherits"] !== "string") {
        return false;
      }
      continue;
    }

    if (typeof profile["authType"] !== "string" || !AUTH_TYPES.has(profile["authType"])) {
      return false;
    }
    if (typeof profile["configDir"] !== "string") {
      return false;
    }
    if (typeof profile["createdAt"] !== "string") {
      return false;
    }
  }
  return true;
}

export function loadConfig(): ArcConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return defaultConfig();
  }
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read config file at ${configPath}: ${message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Config file at ${configPath} contains malformed JSON. Please fix or delete it.`
    );
  }
  if (!validateConfig(parsed)) {
    throw new Error(
      `Config file at ${configPath} has an invalid structure. Expected version: 1, activeProfile (string), and profiles (object).`
    );
  }
  return parsed;
}

export function saveConfig(config: ArcConfig): void {
  const configPath = getConfigPath();
  const dir = getArcDir();

  fs.mkdirSync(dir, { recursive: true });

  const tempPath = path.join(dir, `config.tmp.${crypto.randomBytes(4).toString("hex")}`);
  const content = JSON.stringify(config, null, 2) + "\n";

  fs.writeFileSync(tempPath, content, { encoding: "utf-8" });

  if (process.platform !== "win32") {
    fs.chmodSync(tempPath, 0o600);
  }

  fs.renameSync(tempPath, configPath);
}

export function getActiveProfile(config: ArcConfig): Profile | undefined {
  return config.profiles[config.activeProfile];
}

export function resolveProfileName(config: ArcConfig, name?: string): string {
  return name ?? config.activeProfile;
}

const MAX_INHERITANCE_DEPTH = 10;

/**
 * Resolve a profile by walking its inheritance chain and deep-merging
 * from the root ancestor up to the requested profile.
 *
 * Detects circular inheritance and caps depth at 10 levels.
 */
export function resolveProfile(config: ArcConfig, profileName: string): Profile {
  const chain: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = profileName;

  // Walk the chain from child → root, collecting profile names in order
  while (current) {
    if (visited.has(current)) {
      chain.push(current);
      throw new Error(
        `Circular profile inheritance detected: ${chain.join(" → ")}`
      );
    }
    visited.add(current);
    chain.push(current);

    if (chain.length > MAX_INHERITANCE_DEPTH) {
      throw new Error(
        `Profile inheritance chain exceeds maximum depth (${MAX_INHERITANCE_DEPTH}): ${chain.join(" → ")}`
      );
    }

    const prof: Profile | undefined = config.profiles[current];
    if (!prof) {
      if (current === profileName) {
        throw new Error(`Profile '${current}' not found`);
      }
      throw new Error(
        `Profile '${current}' (inherited by '${chain[chain.indexOf(current) - 1]}') not found`
      );
    }

    current = prof.inherits;
  }

  // Merge from root ancestor → child (last in chain is the root)
  const reversed = [...chain].reverse();
  let merged: Record<string, unknown> = {};
  for (const name of reversed) {
    const prof = config.profiles[name] as unknown as Record<string, unknown>;
    merged = deepMerge(merged, prof);
  }

  // Strip the inherits metadata from the resolved result
  delete merged["inherits"];

  // Validate required fields on the resolved profile
  const requiredFields = ["authType", "configDir", "createdAt"] as const;
  for (const field of requiredFields) {
    if (merged[field] === undefined || merged[field] === null) {
      throw new Error(
        `Resolved profile '${profileName}' is missing required field '${field}' after inheritance from '${chain.join(" → ")}'`
      );
    }
  }

  return merged as unknown as Profile;
}
