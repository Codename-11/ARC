export type AuthType = "oauth" | "api-key" | "bedrock" | "vertex" | "foundry";

/** The agent tool binary this profile targets (e.g. "claude", "gemini", "codex"). */
export type AgentTool = string;

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
}

export interface ArcConfig {
  version: 1;
  activeProfile: string;
  profiles: Record<string, Profile>;
  /** Display order of profile names. */
  profileOrder?: string[];
}

/** @deprecated Use ArcConfig */
export type MulticcConfig = ArcConfig;
