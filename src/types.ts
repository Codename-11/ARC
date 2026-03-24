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
}

export interface ArcConfig {
  version: 1;
  activeProfile: string;
  profiles: Record<string, Profile>;
}

/** @deprecated Use ArcConfig */
export type MulticcConfig = ArcConfig;
