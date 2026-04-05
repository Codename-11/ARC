export type AuthType = "oauth" | "api-key" | "bedrock" | "vertex" | "foundry" | "openai-compat";

export type AgentTool = string;

/**
 * Controls how hook results affect the pipeline.
 * - off: skip all hooks entirely
 * - log: run hooks, log results, never block
 * - advise: run hooks, inject suggestions into metadata, never block
 * - enforce: run hooks, block on failed checks (HookResult.block=true)
 */
export type EnforcementMode = "off" | "log" | "advise" | "enforce";

/** Per-hook configuration in a profile. */
export interface HookConfig {
  enabled: boolean;
  /** Timeout in ms for hook execution. Defaults to 5000. */
  timeout?: number;
  /** Hook-specific options. */
  options?: Record<string, unknown>;
}

/** OpenAI-compatible provider configuration. */
export interface ProviderConfig {
  /** API base URL (e.g. https://openrouter.ai/api/v1, http://localhost:11434/v1) */
  baseUrl: string;
  /** Model identifier (e.g. anthropic/claude-3.5-sonnet, llama3) */
  model?: string;
  /** Env var name that holds the API key. Defaults to OPENAI_API_KEY. */
  apiKeyEnvVar?: string;
  /** Provider display name for UI (e.g. "OpenRouter", "Ollama", "LM Studio") */
  displayName?: string;
}

export interface Profile {
  authType: AuthType;
  tool?: AgentTool;
  configDir: string;
  description?: string;
  createdAt: string;
  /** Name of the parent profile this profile inherits from. */
  inherits?: string;
  apiKeyStorage?: "keyring" | "file";
  envOverrides?: Record<string, string>;
  useShared?: boolean;
  useSharedMemory?: boolean;
  useSharedProjects?: boolean;
  launchArgs?: string[];
  /** Hook enforcement mode for this profile. Defaults to 'log' at runtime. */
  enforcement?: EnforcementMode;
  /** Per-hook configuration overrides. Keys are hook names. */
  hooks?: Record<string, HookConfig>;
  /** Custom instructions / system prompt injected into agent context. */
  instructions?: string;
  /** Path to an instructions file (read at launch time). Takes precedence over inline instructions. */
  instructionsFile?: string;
  /** OpenAI-compatible provider configuration for custom endpoints. */
  provider?: ProviderConfig;
}

export interface ArcSettings {
  confirmLaunch?: boolean;
}

export interface ArcConfig {
  version: 1;
  activeProfile: string;
  profiles: Record<string, Profile>;
  profileOrder?: string[];
  theme?: "dark" | "light";
  sharedSource?: string;
  settings?: ArcSettings;
}

// HealthStatus, HealthCheck, HealthReport — authoritative defs in health.ts
// LogLevel, LogEvent — authoritative defs in logging.ts

export interface SharedManifest {
  syncedAt: string;
  mcpServers: string[];
  commands: string[];
  claudeMd?: boolean;
  memoryLinked?: boolean;
  projectsLinked?: boolean;
  adapterArtifacts?: string[];
}
