import type { ProviderConfig } from "./types.js";

/**
 * Built-in provider presets.
 *
 * Each preset is a partial {@link ProviderConfig}. Presets that use `extends`
 * inherit a builtin adapter's launch behavior (command, auth) and layer env
 * overrides on top — this lets a profile target an Anthropic-compatible
 * endpoint (Z.AI, Qwen, DeepSeek, local Ollama) or isolate a second credential
 * set (claude-work vs. claude-personal) without re-implementing the adapter.
 *
 * Presets are merged into a profile's provider via `resolveProvider()` — the
 * profile's own fields win over preset fields (shallow merge; `env` is also
 * shallow-merged key-by-key).
 */
export const providerPresets: Record<string, Partial<ProviderConfig>> = {
  "zai-glm": {
    extends: "claude",
    displayName: "Z.AI (GLM)",
    label: "Z.AI GLM",
    env: {
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
      ANTHROPIC_AUTH_TOKEN_ENV: "ZAI_API_KEY",
    },
    models: ["glm-4.6"],
  },
  "qwen-max": {
    extends: "claude",
    displayName: "Qwen (DashScope)",
    label: "Qwen Max",
    env: {
      ANTHROPIC_BASE_URL: "https://dashscope-intl.aliyuncs.com/api/v2/apps/anthropic",
      ANTHROPIC_AUTH_TOKEN_ENV: "DASHSCOPE_API_KEY",
    },
    models: ["qwen-max", "qwen-plus"],
  },
  "deepseek-chat": {
    extends: "claude",
    displayName: "DeepSeek (Anthropic)",
    label: "DeepSeek",
    env: {
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_AUTH_TOKEN_ENV: "DEEPSEEK_API_KEY",
    },
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  "ollama-claude-local": {
    extends: "claude",
    displayName: "Ollama (local Anthropic)",
    label: "Ollama local",
    env: {
      ANTHROPIC_BASE_URL: "http://127.0.0.1:11434/anthropic",
    },
    models: ["llama3.1", "qwen2.5-coder"],
  },
  "claude-work": {
    extends: "claude",
    displayName: "Claude (work)",
    label: "Claude (work)",
    env: {
      CLAUDE_CONFIG_DIR: "~/.arc/profiles/claude-work/config",
    },
  },
  "claude-personal": {
    extends: "claude",
    displayName: "Claude (personal)",
    label: "Claude (personal)",
    env: {
      CLAUDE_CONFIG_DIR: "~/.arc/profiles/claude-personal/config",
    },
  },
};

/** Return the list of preset ids in stable, declaration order. */
export function listProviderPresets(): string[] {
  return Object.keys(providerPresets);
}

/** Fetch a preset by id, or `undefined` if none matches. */
export function getProviderPreset(id: string): Partial<ProviderConfig> | undefined {
  return providerPresets[id];
}
