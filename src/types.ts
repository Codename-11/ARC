export type AuthType = "oauth" | "api-key" | "bedrock" | "vertex" | "foundry";

/** The agent tool binary this profile targets (e.g. "claude", "gemini", "codex"). */
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

export interface Profile {
  authType: AuthType;
  /** Which agent tool binary to launch for this profile. Defaults to "claude". */
  tool?: AgentTool;
  configDir: string;
  description?: string;
  createdAt: string;
  apiKeyStorage?: "keyring" | "file";
  envOverrides?: Record<string, string>;
  /** Whether this profile inherits from the shared layer (~/.arc/shared/). */
  useShared?: boolean;
  /** Whether this profile's memory/ dir is linked to ~/.arc/shared/memory/. */
  useSharedMemory?: boolean;
  /** Whether this profile's projects/ dir is linked to ~/.arc/shared/projects/. */
  useSharedProjects?: boolean;
  /** Default flags passed to the agent tool on every launch. */
  launchArgs?: string[];
  /** Hook enforcement mode for this profile. Defaults to 'log' at runtime. */
  enforcement?: EnforcementMode;
  /** Per-hook configuration overrides. Keys are hook names. */
  hooks?: Record<string, HookConfig>;
}

export interface ArcSettings {
  /** Show a confirmation prompt before launching a profile (default: false). */
  confirmLaunch?: boolean;
}

export interface ArcConfig {
  version: 1;
  activeProfile: string;
  profiles: Record<string, Profile>;
  /** Display order of profile names. */
  profileOrder?: string[];
  /** Persisted TUI theme preference. */
  theme?: "dark" | "light";
  /** Profile whose config auto-populates the shared layer on sync. */
  sharedSource?: string;
  /** User-configurable settings. */
  settings?: ArcSettings;
}
