import type { Profile } from "../types.js";

// ─── Lifecycle & supervision types ───────────────────────────────────

/** Permission tier for adapter capabilities. */
export type PermissionTier = "coordinator" | "interactive" | "worker";

/** Declares what an adapter supports at the capability level. */
export interface AdapterCapabilities {
  hooks: boolean;
  sdkControl: boolean;
  pluginSystem: boolean;
  mcpSupport: boolean;
  jsonOutput: boolean;
  sandboxing: boolean;
  processWrap: boolean;
  remoteSupport: boolean;
  permissionTier: PermissionTier;
}

/** Options passed when launching an agent process. */
export interface LaunchOptions {
  args: string[];
  env: Record<string, string | undefined>;
  cwd?: string;
  beforeSpawn?: () => Promise<void>;
  /**
   * Force a specific launch mode regardless of profile/CLI settings.
   * Orchestrators (roundtable, pipelines) should pass `"worker"` to ensure
   * the tool runs under ARC supervision.
   */
  launchMode?: "native" | "worker";
}

/** Handle for a running agent process. */
export interface AgentProcess {
  pid: number;
  tool: string;
  profile: string;
  startedAt: Date;
}

// ─── Placeholder types (owned by future milestones) ──────────────────

/** Result of a preflight check. @milestone M003 */
export interface PreflightResult {
  proceed: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/** Result of a postflight check. @milestone M003 */
export interface PostflightResult {
  proceed: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/** Context passed into preflight/postflight hooks. @milestone M003 */
export interface HookContext {
  message: string;
  sessionId: string;
  profile: Profile;
  adapter: string;
}

/** Response returned from an agent interaction. @milestone M003 */
export interface AgentResponse {
  content: string;
  toolCalls?: unknown[];
}

/** A streaming output event from a running agent. @milestone M009 */
export interface OutputEvent {
  type: string;
  content: string;
  timestamp: Date;
}

/** Status snapshot of a running agent process. @milestone M012 */
export interface AgentStatus {
  running: boolean;
  pid?: number;
  uptime?: number;
}

/** Arbitrary metadata for hook injection. */
export type HookMetadata = Record<string, unknown>;

// ─── Existing types ──────────────────────────────────────────────────

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

  // ─── Lifecycle & supervision (S02) ─────────────────────────────────

  /** Adapter capability declaration. */
  readonly capabilities: AdapterCapabilities;

  /** Launch an agent process for the given profile. */
  launch(profile: Profile, options: LaunchOptions): Promise<AgentProcess>;

  /** Terminate a running agent process. */
  terminate(process: AgentProcess): Promise<void>;

  /** Check whether an agent process is still running. */
  isRunning(process: AgentProcess): boolean;

  /** Run pre-launch validation/checks. @milestone M003 */
  preflight?(ctx: HookContext): Promise<PreflightResult>;

  /** Run post-interaction checks. @milestone M003 */
  postflight?(ctx: HookContext, response: AgentResponse): Promise<PostflightResult>;

  /** Inject runtime context/metadata into a running process. @milestone M003 */
  injectContext?(process: AgentProcess, metadata: HookMetadata): Promise<void>;

  /** Subscribe to streaming output from a running process. @milestone M009 */
  onOutput?(process: AgentProcess, handler: (event: OutputEvent) => void): void;

  /** Query the current status of a running process. @milestone M012 */
  getStatus?(process: AgentProcess): Promise<AgentStatus>;
}

export type ToolAdapter = RuntimeAdapter;
export type ArcToolAdapter = RuntimeAdapter;
