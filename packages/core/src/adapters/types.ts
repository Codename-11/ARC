import type { Profile } from "../types.js";

export interface DetectedTool {
  tool: string;
  configDir: string;
  displayName: string;
}

export type DetectedToolConfig = DetectedTool;

export interface CredentialStatus {
  authenticated: boolean;
  authType: Profile["authType"];
  email?: string;
  accountTier?: string;
  expiresAt?: number;
  expired?: boolean;
  method: "oauth" | "api-key" | "env-var" | "bedrock" | "vertex" | "foundry";
}

export interface AdapterHealthCheck {
  key: string;
  label: string;
  status: "ok" | "pass" | "warn" | "fail";
  summary: string;
  detail?: string;
}

export interface AdapterSharedArtifacts {
  syncProfile(profileConfigDir: string): string[];
  unsyncProfile(profileConfigDir: string, syncedArtifacts: string[]): void;
  pullProfile(profileConfigDir: string): string[];
}

export interface ImportFinalizationContext {
  sourceDir: string;
  profileDir: string;
  copiedItems: string[];
}

export interface ImportFinalizationResult {
  copiedItems: string[];
}

export interface RuntimeAdapter {
  id: string;
  displayName: string;
  detectConfigs(): DetectedTool[];
  getCredentialStatus(profile: Profile, profileName?: string): Promise<CredentialStatus>;
  buildProfileEnv(
    profile: Profile,
    profileName: string
  ): Promise<Record<string, string | undefined>>;
  getInstallHint(binaryName?: string): string;
  getHealthChecks?(profile: Profile, profileName?: string): Promise<AdapterHealthCheck[]>;
  detectAuthType?(sourceDir: string): Profile["authType"] | null;
  describeImportEntry?(entryName: string): string | undefined;
  finalizeImport?(
    context: ImportFinalizationContext
  ): Promise<ImportFinalizationResult | string[]> | ImportFinalizationResult | string[];
  sharedArtifacts?: AdapterSharedArtifacts;
}

export type ToolAdapter = RuntimeAdapter;
export type ArcToolAdapter = RuntimeAdapter;
