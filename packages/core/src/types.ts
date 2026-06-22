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

/**
 * Builtin adapter a provider can extend. When set, the provider inherits the
 * adapter's launch behavior (command, argument handling, auth flow) and layers
 * env/model/command overrides on top.
 */
export type ProviderExtends = "claude" | "codex" | "gemini" | "opencode";

/**
 * Provider configuration. Supports two modes:
 *
 *  - **OpenAI-compat**: set `baseUrl` (+ optional `model`, `apiKeyEnvVar`). The
 *    agent talks to an OpenAI-compatible endpoint. Used by OpenRouter, Ollama,
 *    LM Studio, Together, Groq, etc.
 *
 *  - **Adapter extension**: set `extends` to a builtin adapter (e.g. `"claude"`).
 *    The profile inherits the adapter's command/auth but ARC injects `env` / `model`
 *    overrides at launch time. Used for Anthropic-compatible endpoints (Z.AI,
 *    Qwen, DeepSeek, local Ollama) and multi-account splits (claude-work,
 *    claude-personal).
 *
 * Both modes may coexist on one profile; `resolveProvider` merges a preset into
 * the profile and returns the final config.
 */
export interface ProviderConfig {
  /**
   * Optional builtin adapter to extend. When set, the provider inherits the
   * adapter's launch behavior and layers the other fields on top.
   */
  extends?: ProviderExtends;
  /** API base URL (e.g. https://openrouter.ai/api/v1, http://localhost:11434/v1) */
  baseUrl?: string;
  /** Default model identifier (e.g. anthropic/claude-3.5-sonnet, llama3). */
  model?: string;
  /** List of models this provider advertises (for UI / model pickers). */
  models?: string[];
  /** Env var name that holds the API key. Defaults to OPENAI_API_KEY. */
  apiKeyEnvVar?: string;
  /** Provider display name for UI (e.g. "OpenRouter", "Ollama", "LM Studio") */
  displayName?: string;
  /** Short label for compact UIs (e.g. "Claude (work)"). */
  label?: string;
  /** Additional environment variables injected at launch. Shallow-merged. */
  env?: Record<string, string>;
  /** Override the launch command binary (rarely used — prefer `extends`). */
  command?: string;
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
  /**
   * Launch mode for this profile.
   * - `native` (default): full TTY handoff via spawnSync with inherited stdio. ARC exits,
   *   the tool paints its own TUI (e.g. Claude's statusLine). Use for daily interactive work.
   * - `worker`: run under ARC supervision via the adapter's managed lifecycle — stdout is
   *   captured for monitoring. Use for orchestration, roundtable, and programmatic flows.
   */
  launchMode?: "native" | "worker";
}

export interface ArcSettings {
  confirmLaunch?: boolean;
}

export interface ArcConfig {
  version: 1;
  /**
   * Name of the active profile, or null when no profile is active.
   * A null active profile means `arc launch` / tool commands with no explicit
   * profile argument will fall back to bare mode (native tool launch, no env
   * injection). Use `arc profile switch <name>` or `arc profile clear-active`
   * to change this.
   */
  activeProfile: string | null;
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
