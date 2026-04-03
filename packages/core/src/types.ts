export type AuthType = "oauth" | "api-key" | "bedrock" | "vertex" | "foundry";

export type AgentTool = string;

export interface Profile {
  authType: AuthType;
  tool?: AgentTool;
  configDir: string;
  description?: string;
  createdAt: string;
  apiKeyStorage?: "keyring" | "file";
  envOverrides?: Record<string, string>;
  useShared?: boolean;
  useSharedMemory?: boolean;
  useSharedProjects?: boolean;
  launchArgs?: string[];
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
