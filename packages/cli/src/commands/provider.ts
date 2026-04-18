import { loadConfig, saveConfig } from "../config.js";
import { success, error, info, cmd } from "../display.js";
import type { ProviderConfig } from "@axiom-labs/arc-core";

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

export async function handleProviderSet(
  name: string,
  opts: { baseUrl?: string; model?: string; apiKeyVar?: string; displayName?: string },
): Promise<void> {
  const { config, profileName, profile } = getProfile(name);

  if (!opts.baseUrl && !opts.model && !opts.apiKeyVar && !opts.displayName) {
    error("Provide at least one option: --base-url, --model, --api-key-var, or --display-name");
    info(`Example: ${cmd("arc provider set " + profileName + " --base-url https://openrouter.ai/api/v1 --model anthropic/claude-sonnet-4")}`);
    process.exit(1);
  }

  // Check if input matches a preset
  const preset = PRESETS.find((p) =>
    opts.baseUrl === p.baseUrl || opts.displayName?.toLowerCase() === p.id,
  );

  const existing: ProviderConfig = profile.provider ?? { baseUrl: "" };

  if (opts.baseUrl) existing.baseUrl = opts.baseUrl;
  if (opts.model) existing.model = opts.model;
  if (opts.apiKeyVar) existing.apiKeyEnvVar = opts.apiKeyVar;
  if (opts.displayName) existing.displayName = opts.displayName;

  // Apply preset defaults for fields not explicitly set
  if (preset) {
    if (!opts.apiKeyVar && !existing.apiKeyEnvVar) existing.apiKeyEnvVar = preset.apiKeyEnvVar;
    if (!opts.displayName && !existing.displayName) existing.displayName = preset.displayName;
  }

  profile.provider = existing;

  // Auto-set authType to openai-compat if not already
  if (profile.authType !== "openai-compat" && profile.authType !== "api-key") {
    profile.authType = "openai-compat";
  }

  saveConfig(config);

  const label = existing.displayName ?? "Custom Provider";
  success(`Provider for "${profileName}" configured: ${label}`);
  if (existing.baseUrl) info(`  Base URL: ${existing.baseUrl}`);
  if (existing.model) info(`  Model: ${existing.model}`);
  if (existing.apiKeyEnvVar) info(`  API key env var: ${existing.apiKeyEnvVar}`);

  // Hint about setting the key
  const keyVar = existing.apiKeyEnvVar ?? "OPENAI_API_KEY";
  info(`\nSet your API key: ${cmd(`arc set-key ${profileName}`)}`);
  info(`Or via env: ${cmd(`export ${keyVar}=sk-...`)}`);
}

export async function handleProviderShow(name?: string): Promise<void> {
  const { profileName, profile } = getProfile(name);
  const p = profile.provider;

  if (!p) {
    info(`No provider configured for "${profileName}".`);
    info(`Set one with: ${cmd(`arc provider set ${profileName} --base-url <url>`)}`);
    info(`Or use a preset: ${cmd("arc provider presets")}`);
    return;
  }

  const label = p.displayName ?? "Custom Provider";
  info(`Provider for "${profileName}": ${label}`);
  console.log(`  Base URL:       ${p.baseUrl || "(not set)"}`);
  console.log(`  Model:          ${p.model || "(not set)"}`);
  console.log(`  API key var:    ${p.apiKeyEnvVar || "OPENAI_API_KEY"}`);
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
  info("Known provider presets:\n");

  for (const p of PRESETS) {
    console.log(`  ${p.displayName.padEnd(14)} ${p.baseUrl}`);
    console.log(`  ${"".padEnd(14)} Key var: ${p.apiKeyEnvVar}`);
    console.log(`  ${"".padEnd(14)} Models: ${p.models.slice(0, 3).join(", ")}`);
    console.log(`  ${"".padEnd(14)} ${p.notes}`);
    console.log();
  }

  info("Quick setup example:");
  console.log(`  ${cmd("arc create openrouter --tool openai-compat --auth-type openai-compat")}`);
  console.log(`  ${cmd("arc provider set openrouter --base-url https://openrouter.ai/api/v1 --model anthropic/claude-sonnet-4")}`);
  console.log(`  ${cmd("arc set-key openrouter")}`);
  console.log(`  ${cmd("arc launch openrouter")}`);
}
