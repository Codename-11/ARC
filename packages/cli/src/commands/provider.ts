import { loadConfig, saveConfig } from "../config.js";
import { success, error, info, cmd } from "../display.js";
import type { ProviderConfig } from "@axiom-labs/arc-core";
import { providerPresets, resolveProvider } from "@axiom-labs/arc-core";

// ─── Known provider presets ─────────────────────────────────────────

interface ProviderPreset {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  models: string[];
  notes: string;
}

const PRESETS: ProviderPreset[] = [
  {
    id: "openrouter",
    displayName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnvVar: "OPENROUTER_API_KEY",
    models: ["anthropic/claude-sonnet-4", "openai/gpt-4o", "google/gemini-2.5-pro", "meta-llama/llama-4-maverick"],
    notes: "Multi-provider gateway — use any model from any provider",
  },
  {
    id: "ollama",
    displayName: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    apiKeyEnvVar: "OLLAMA_API_KEY",
    models: ["llama3", "codellama", "mistral", "deepseek-coder"],
    notes: "Local models — no API key needed (set dummy value)",
  },
  {
    id: "lm-studio",
    displayName: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    apiKeyEnvVar: "LM_STUDIO_API_KEY",
    models: ["loaded-model"],
    notes: "Local inference — no API key needed (set dummy value)",
  },
  {
    id: "together",
    displayName: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    apiKeyEnvVar: "TOGETHER_API_KEY",
    models: ["meta-llama/Llama-3-70b-chat-hf", "mistralai/Mixtral-8x7B-Instruct-v0.1"],
    notes: "Cloud GPU inference for open models",
  },
  {
    id: "groq",
    displayName: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnvVar: "GROQ_API_KEY",
    models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
    notes: "Ultra-fast inference on custom LPU hardware",
  },
  {
    id: "minimax",
    displayName: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    apiKeyEnvVar: "MINIMAX_API_KEY",
    models: ["MiniMax-Text-01", "abab6.5s-chat"],
    notes: "MiniMax cloud models",
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnvVar: "DEEPSEEK_API_KEY",
    models: ["deepseek-chat", "deepseek-coder"],
    notes: "DeepSeek coding-focused models",
  },
];

// ─── Helpers ────────────────────────────────────────────────────────

function getProfile(name?: string) {
  const config = loadConfig();
  const profileName = name ?? config.activeProfile;
  if (!profileName) {
    error("No active profile. Use 'arc profile switch <name>' or pass a profile name.");
    process.exit(1);
  }
  const profile = config.profiles[profileName];
  if (!profile) {
    error(`Profile "${profileName}" not found.`);
    process.exit(1);
  }
  return { config, profileName, profile };
}

// ─── Handlers ───────────────────────────────────────────────────────

export interface ProviderSetOpts {
  baseUrl?: string;
  model?: string;
  apiKeyVar?: string;
  displayName?: string;
  /** Name of a builtin preset in `providerPresets` (e.g. "zai-glm", "claude-work"). */
  preset?: string;
}

export async function handleProviderSet(
  name: string,
  opts: ProviderSetOpts,
): Promise<void> {
  const { config, profileName, profile } = getProfile(name);

  const presetKey = opts.preset;
  if (!presetKey && !opts.baseUrl && !opts.model && !opts.apiKeyVar && !opts.displayName) {
    error("Provide at least one option: --preset, --base-url, --model, --api-key-var, or --display-name");
    info(`Example: ${cmd("arc provider set " + profileName + " --preset zai-glm")}`);
    info(`     or: ${cmd("arc provider set " + profileName + " --base-url https://openrouter.ai/api/v1 --model anthropic/claude-sonnet-4")}`);
    process.exit(1);
  }

  if (presetKey) {
    const preset = providerPresets[presetKey];
    if (!preset) {
      const available = Object.keys(providerPresets).join(", ");
      error(`Unknown preset "${presetKey}". Available: ${available}`);
      info(`Run ${cmd("arc provider presets")} to see details.`);
      process.exit(1);
    }

    // Preset overwrites existing provider fields; explicit flags still win over both.
    const merged: ProviderConfig = {
      ...(profile.provider ?? {}),
      ...preset,
    };
    if (preset.env || profile.provider?.env) {
      merged.env = { ...(preset.env ?? {}), ...(profile.provider?.env ?? {}) };
    }
    if (opts.baseUrl) merged.baseUrl = opts.baseUrl;
    if (opts.model) merged.model = opts.model;
    if (opts.apiKeyVar) merged.apiKeyEnvVar = opts.apiKeyVar;
    if (opts.displayName) merged.displayName = opts.displayName;

    profile.provider = merged;
    saveConfig(config);

    const label = merged.label ?? merged.displayName ?? presetKey;
    success(`Provider for "${profileName}" configured from preset "${presetKey}": ${label}`);
    if (merged.extends) info(`  Extends: ${merged.extends}`);
    if (merged.baseUrl) info(`  Base URL: ${merged.baseUrl}`);
    if (merged.model) info(`  Model: ${merged.model}`);
    if (merged.models?.length) info(`  Models: ${merged.models.join(", ")}`);
    if (merged.apiKeyEnvVar) info(`  API key env var: ${merged.apiKeyEnvVar}`);
    if (merged.env && Object.keys(merged.env).length > 0) {
      for (const [k, v] of Object.entries(merged.env)) {
        info(`  env ${k}=${v}`);
      }
    }
    return;
  }

  // OpenAI-compat path: match a legacy preset by baseUrl or displayName id.
  const legacyPreset = PRESETS.find((p) =>
    opts.baseUrl === p.baseUrl || opts.displayName?.toLowerCase() === p.id,
  );

  const existing: ProviderConfig = profile.provider ?? { baseUrl: "" };

  if (opts.baseUrl) existing.baseUrl = opts.baseUrl;
  if (opts.model) existing.model = opts.model;
  if (opts.apiKeyVar) existing.apiKeyEnvVar = opts.apiKeyVar;
  if (opts.displayName) existing.displayName = opts.displayName;

  if (legacyPreset) {
    if (!opts.apiKeyVar && !existing.apiKeyEnvVar) existing.apiKeyEnvVar = legacyPreset.apiKeyEnvVar;
    if (!opts.displayName && !existing.displayName) existing.displayName = legacyPreset.displayName;
  }

  profile.provider = existing;

  if (profile.authType !== "openai-compat" && profile.authType !== "api-key") {
    profile.authType = "openai-compat";
  }

  saveConfig(config);

  const label = existing.displayName ?? "Custom Provider";
  success(`Provider for "${profileName}" configured: ${label}`);
  if (existing.baseUrl) info(`  Base URL: ${existing.baseUrl}`);
  if (existing.model) info(`  Model: ${existing.model}`);
  if (existing.apiKeyEnvVar) info(`  API key env var: ${existing.apiKeyEnvVar}`);

  const keyVar = existing.apiKeyEnvVar ?? "OPENAI_API_KEY";
  info(`\nSet your API key: ${cmd(`arc set-key ${profileName}`)}`);
  info(`Or via env: ${cmd(`export ${keyVar}=sk-...`)}`);
}

export async function handleProviderShow(name?: string): Promise<void> {
  const { profileName, profile } = getProfile(name);
  const resolved = resolveProvider(profile);

  if (!resolved) {
    info(`No provider configured for "${profileName}".`);
    info(`Set one with: ${cmd(`arc provider set ${profileName} --base-url <url>`)}`);
    info(`Or use a preset: ${cmd("arc provider presets")}`);
    return;
  }

  const label = resolved.label ?? resolved.displayName ?? "Custom Provider";
  info(`Provider for "${profileName}": ${label}`);
  if (resolved.extends) console.log(`  Extends:        ${resolved.extends}`);
  console.log(`  Base URL:       ${resolved.baseUrl || "(not set)"}`);
  console.log(`  Model:          ${resolved.model || "(not set)"}`);
  if (resolved.models?.length) console.log(`  Models:         ${resolved.models.join(", ")}`);
  console.log(`  API key var:    ${resolved.apiKeyEnvVar || "OPENAI_API_KEY"}`);
  if (resolved.env && Object.keys(resolved.env).length > 0) {
    console.log(`  Environment:`);
    for (const [k, v] of Object.entries(resolved.env)) {
      console.log(`    ${k}=${v}`);
    }
  }
}

export async function handleProviderClear(name: string): Promise<void> {
  const { config, profileName, profile } = getProfile(name);

  if (!profile.provider) {
    info(`No provider configured for "${profileName}".`);
    return;
  }

  profile.provider = undefined;
  saveConfig(config);
  success(`Provider cleared for "${profileName}".`);
}

export async function handleProviderPresets(): Promise<void> {
  info("Adapter-extends presets (inherit a builtin adapter + env overrides):\n");

  const idCol = Math.max("ID".length, ...Object.keys(providerPresets).map((k) => k.length));
  console.log(
    `  ${"ID".padEnd(idCol)}  ${"Extends".padEnd(9)}  Label / Models`
  );
  console.log(
    `  ${"".padEnd(idCol, "-")}  ${"".padEnd(9, "-")}  --------------------------------`
  );
  for (const [id, preset] of Object.entries(providerPresets)) {
    const label = preset.label ?? preset.displayName ?? "";
    const models = preset.models?.length ? `  models: ${preset.models.join(", ")}` : "";
    console.log(`  ${id.padEnd(idCol)}  ${(preset.extends ?? "-").padEnd(9)}  ${label}${models}`);
    if (preset.env) {
      for (const [k, v] of Object.entries(preset.env)) {
        console.log(`  ${"".padEnd(idCol)}  ${"".padEnd(9)}    ${k}=${v}`);
      }
    }
  }

  console.log();
  info("OpenAI-compatible presets (set baseUrl + model directly):\n");

  for (const p of PRESETS) {
    console.log(`  ${p.displayName.padEnd(14)} ${p.baseUrl}`);
    console.log(`  ${"".padEnd(14)} Key var: ${p.apiKeyEnvVar}`);
    console.log(`  ${"".padEnd(14)} Models: ${p.models.slice(0, 3).join(", ")}`);
    console.log(`  ${"".padEnd(14)} ${p.notes}`);
    console.log();
  }

  info("Quick setup examples:");
  console.log(`  ${cmd("arc provider set myprof --preset zai-glm")}`);
  console.log(`  ${cmd("arc provider set openrouter --base-url https://openrouter.ai/api/v1 --model anthropic/claude-sonnet-4")}`);
  console.log(`  ${cmd("arc set-key openrouter")}`);
  console.log(`  ${cmd("arc launch openrouter")}`);
}
