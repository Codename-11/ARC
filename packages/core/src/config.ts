import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getArcDir, getConfigPath, getProfileDir } from "./paths.js";
import { deepMerge } from "./shared-fs.js";
import { providerPresets } from "./provider-presets.js";
import type { ArcConfig, Profile, ProviderConfig } from "./types.js";

const AUTH_TYPES = new Set(["oauth", "api-key", "bedrock", "vertex", "foundry", "openai-compat"]);

export function defaultConfig(): ArcConfig {
  // New installs start with no active profile — tools launched through
  // ARC without an explicit profile default to native (bare) mode.
  return { version: 1, activeProfile: null, profiles: {} };
}

export function validateConfig(config: unknown): config is ArcConfig {
  if (typeof config !== "object" || config === null) {
    return false;
  }

  const obj = config as Record<string, unknown>;
  if (obj["version"] !== 1) {
    return false;
  }
  // activeProfile is either a string (named profile) or null (none).
  if (obj["activeProfile"] !== null && typeof obj["activeProfile"] !== "string") {
    return false;
  }

  if (typeof obj["profiles"] !== "object" || obj["profiles"] === null) {
    return false;
  }

  for (const profile of Object.values(obj["profiles"] as Record<string, unknown>)) {
    if (typeof profile !== "object" || profile === null) {
      return false;
    }

    const value = profile as Record<string, unknown>;

    // Child profiles with an `inherits` field skip required-field checks;
    // the resolved profile is validated at resolution time.
    if (value["inherits"] !== undefined) {
      if (typeof value["inherits"] !== "string") {
        return false;
      }
      continue;
    }

    if (typeof value["authType"] !== "string" || !AUTH_TYPES.has(value["authType"])) {
      return false;
    }
    if (typeof value["configDir"] !== "string" || typeof value["createdAt"] !== "string") {
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
  const dir = getArcDir();
  const configPath = getConfigPath();
  fs.mkdirSync(dir, { recursive: true });

  const tempPath = path.join(dir, `config.tmp.${crypto.randomBytes(4).toString("hex")}`);
  fs.writeFileSync(tempPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  if (process.platform !== "win32") {
    fs.chmodSync(tempPath, 0o600);
  }
  fs.renameSync(tempPath, configPath);
}

export function getActiveProfile(config: ArcConfig): Profile | undefined {
  if (config.activeProfile === null) return undefined;
  return config.profiles[config.activeProfile];
}

/**
 * Resolve a profile name for a command.
 * Throws when no `name` is provided and no active profile is set.
 */
export function resolveProfileName(config: ArcConfig, name?: string): string {
  if (name) return name;
  if (config.activeProfile === null) {
    throw new Error(
      "No active profile. Use 'arc profile switch <name>' or pass --profile."
    );
  }
  return config.activeProfile;
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

/**
 * Resolve the effective instructions text for a profile.
 *
 * Priority: instructionsFile (read from disk) > inline instructions > undefined.
 * Returns undefined if no instructions are configured.
 */
export function resolveInstructions(profile: Profile): string | undefined {
  if (profile.instructionsFile) {
    const resolved = path.isAbsolute(profile.instructionsFile)
      ? profile.instructionsFile
      : path.resolve(profile.configDir, profile.instructionsFile);
    try {
      return fs.readFileSync(resolved, "utf-8");
    } catch {
      // File missing or unreadable — fall through to inline
    }
  }
  return profile.instructions;
}

/**
 * Built-in defaults applied when a provider extends a known adapter. These are
 * the "base" fields a profile inherits before its own values override. For now
 * the adapter-level defaults are minimal — the meaningful env/model data lives
 * in {@link providerPresets}, which the CLI applies by copying the preset into
 * the profile's provider config.
 */
const ADAPTER_DEFAULTS: Record<string, Partial<ProviderConfig>> = {
  claude: {},
  codex: {},
  gemini: {},
  opencode: {},
};

/**
 * Resolve the effective provider config for a profile.
 *
 * Merge rules:
 *  1. If `profile.provider` is undefined → returns `undefined`.
 *  2. If `provider.extends` is unset → returns a fresh shallow copy (idempotent).
 *  3. If `provider.extends` names a known source (an adapter or a preset id),
 *     the source fields are layered **under** the profile's own values. Scalar
 *     fields: profile wins on conflict. `env` is shallow-merged key-by-key
 *     (source first, profile last). `models` is replaced by the profile when
 *     explicitly set; otherwise taken from the source.
 *
 * The returned object is always a fresh shallow copy — the profile is not
 * mutated.
 */
export function resolveProvider(profile: Profile): ProviderConfig | undefined {
  const own = profile.provider;
  if (!own) return undefined;
  if (!own.extends) return { ...own };

  // `extends` may reference a builtin adapter OR (via CLI copy-through) carry
  // over to the preset-id lookup. Adapter defaults take precedence if both match.
  const base: Partial<ProviderConfig> | undefined =
    ADAPTER_DEFAULTS[own.extends] ?? providerPresets[own.extends];
  if (!base) return { ...own };

  // Scalar merge: base defaults, profile overrides win.
  const merged: ProviderConfig = { ...base, ...own };

  // env: shallow merge (base first, profile last).
  if (base.env || own.env) {
    merged.env = { ...(base.env ?? {}), ...(own.env ?? {}) };
  }

  // models: profile replaces base when set; otherwise inherit.
  if (own.models === undefined && base.models) {
    merged.models = [...base.models];
  }

  return merged;
}

export interface CloneProfileOptions {
  /** When true (default), recursively copy the source configDir to the new profile directory. */
  copyConfigDir?: boolean;
}

/**
 * Deep-copy a profile record from `src` to `dst`, resetting `createdAt` and
 * (optionally) copying the on-disk configDir to the new profile's location.
 *
 * Mutates and returns `config`. Callers are responsible for persisting via saveConfig().
 *
 * Throws if `src` does not exist or `dst` already exists. If the source
 * configDir has been deleted, the profile record is still cloned but the
 * directory copy is silently skipped (warning is left to the caller's UI).
 */
export function cloneProfile(
  config: ArcConfig,
  src: string,
  dst: string,
  opts?: CloneProfileOptions
): ArcConfig {
  if (!config.profiles[src]) {
    throw new Error(`Source profile '${src}' not found`);
  }
  if (src === dst) {
    throw new Error(`Destination name must differ from source ('${src}')`);
  }
  if (config.profiles[dst]) {
    throw new Error(`Profile '${dst}' already exists`);
  }

  const source = config.profiles[src];

  // Deep-copy the profile record. structuredClone is available in Node 17+.
  const cloned: Profile =
    typeof structuredClone === "function"
      ? (structuredClone(source) as Profile)
      : (JSON.parse(JSON.stringify(source)) as Profile);

  cloned.createdAt = new Date().toISOString();

  const copyConfigDir = opts?.copyConfigDir !== false;
  if (copyConfigDir) {
    const newDir = getProfileDir(dst);
    const srcDir = source.configDir;
    const srcExists = srcDir && fs.existsSync(srcDir);

    if (srcExists) {
      fs.mkdirSync(newDir, { recursive: true });
      fs.cpSync(srcDir, newDir, {
        recursive: true,
        force: true,
        dereference: true,
        filter: (s: string) => {
          const base = path.basename(s);
          return base !== "node_modules" && base !== ".bin";
        },
      });
    } else {
      // Source dir missing — still create an empty profile dir so launches don't explode.
      fs.mkdirSync(newDir, { recursive: true });
    }
    cloned.configDir = newDir;
  }

  config.profiles[dst] = cloned;
  return config;
}
