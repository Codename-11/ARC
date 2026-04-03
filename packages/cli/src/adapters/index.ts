import { createInterface } from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import claudeAdapter from "@axiom-labs/arc-adapter-claude";
import { retrieveSecret, writeLogEvent } from "@axiom-labs/arc-core";
import {
  spawnManagedProcess,
  terminateProcess,
  isProcessRunning,
  parseJsonlLine,
} from "@axiom-labs/arc-core";
import type { Profile } from "@axiom-labs/arc-core";
import type {
  AgentProcess,
  CredentialStatus,
  DetectedTool,
  LaunchOptions,
  OutputEvent,
  RuntimeAdapter,
  AdapterCapabilities,
} from "@axiom-labs/arc-core";
import type { ManagedProcessHandle } from "@axiom-labs/arc-core";

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readGeminiOAuthCredentials(configDir: string): OAuthCredentials | null {
  const obj = readJsonFile(path.join(configDir, "oauth_creds.json"));
  if (!obj) return null;
  if (
    typeof obj["access_token"] !== "string" ||
    typeof obj["refresh_token"] !== "string" ||
    typeof obj["expiry_date"] !== "number"
  ) {
    return null;
  }
  return {
    accessToken: obj["access_token"],
    refreshToken: obj["refresh_token"],
    expiresAt: obj["expiry_date"],
  };
}

function readCodexOAuthCredentials(configDir: string): OAuthCredentials | null {
  const obj = readJsonFile(path.join(configDir, "auth.json"));
  if (!obj || typeof obj["tokens"] !== "object" || obj["tokens"] === null) return null;
  const tokens = obj["tokens"] as Record<string, unknown>;
  if (typeof tokens["access_token"] !== "string" || typeof tokens["refresh_token"] !== "string") {
    return null;
  }

  let expiresAt = Infinity;
  try {
    const payload = tokens["access_token"].split(".")[1];
    if (payload) {
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (typeof decoded.exp === "number") {
        expiresAt = decoded.exp * 1000;
      }
    }
  } catch {
    // ignore malformed token
  }

  return {
    accessToken: tokens["access_token"],
    refreshToken: tokens["refresh_token"],
    expiresAt,
  };
}

/** Optional lifecycle overrides injected into createBasicAdapter. */
interface LifecycleOverrides {
  launch?: (profile: Profile, options: LaunchOptions) => Promise<AgentProcess>;
  terminate?: (process: AgentProcess) => Promise<void>;
  isRunning?: (process: AgentProcess) => boolean;
  onOutput?: (process: AgentProcess, handler: (event: OutputEvent) => void) => void;
}

function createBasicAdapter(config: {
  id: string;
  displayName: string;
  dirName: string;
  markerFiles: string[];
  installHint: string;
  credentialReader?: (configDir: string) => OAuthCredentials | null;
  configEnvVar?: string;
  capabilities?: AdapterCapabilities;
  lifecycle?: LifecycleOverrides;
}): RuntimeAdapter {
  const adapterCapabilities: AdapterCapabilities = config.capabilities ?? {
    hooks: false,
    sdkControl: false,
    pluginSystem: false,
    mcpSupport: false,
    jsonOutput: false,
    sandboxing: false,
    processWrap: true,
    remoteSupport: false,
    permissionTier: "interactive",
  };

  return {
    id: config.id,
    displayName: config.displayName,
    capabilities: adapterCapabilities,
    detectConfigs(): DetectedTool[] {
      const configDir = path.join(os.homedir(), config.dirName);
      if (!fs.existsSync(configDir)) return [];
      const hasMarker = config.markerFiles.some((file) => fs.existsSync(path.join(configDir, file)));
      return hasMarker ? [{ tool: config.id, configDir, displayName: config.displayName }] : [];
    },
    async getCredentialStatus(profile: Profile): Promise<CredentialStatus> {
      switch (profile.authType) {
        case "oauth": {
          const creds = config.credentialReader?.(profile.configDir);
          if (!creds) {
            return { authenticated: false, authType: "oauth", method: "oauth" };
          }
          const hasRefreshToken = creds.refreshToken.length > 0;
          return {
            authenticated: hasRefreshToken,
            authType: "oauth",
            expiresAt: Number.isFinite(creds.expiresAt) ? creds.expiresAt : undefined,
            expired: hasRefreshToken ? false : creds.expiresAt < Date.now(),
            method: "oauth",
          };
        }
        case "api-key": {
          const secret = await retrieveSecret(path.basename(profile.configDir));
          return {
            authenticated: Boolean(secret),
            authType: "api-key",
            method: profile.envOverrides ? "env-var" : "api-key",
          };
        }
        case "bedrock":
          return {
            authenticated:
              profile.envOverrides?.["AWS_ACCESS_KEY_ID"] !== undefined ||
              profile.envOverrides?.["AWS_PROFILE"] !== undefined,
            authType: "bedrock",
            method: "bedrock",
          };
        case "vertex":
          return {
            authenticated: profile.envOverrides?.["GOOGLE_APPLICATION_CREDENTIALS"] !== undefined,
            authType: "vertex",
            method: "vertex",
          };
        case "foundry":
          return {
            authenticated: profile.envOverrides?.["FOUNDRY_API_KEY"] !== undefined,
            authType: "foundry",
            method: "foundry",
          };
      }
    },
    async buildProfileEnv(profile: Profile): Promise<Record<string, string | undefined>> {
      const env: Record<string, string | undefined> = {
        CLAUDE_CONFIG_DIR: profile.configDir,
      };
      if (config.configEnvVar) {
        env[config.configEnvVar] = profile.configDir;
      }
      for (const [key, value] of Object.entries(profile.envOverrides ?? {})) {
        env[key] = value;
      }
      return env;
    },
    getInstallHint(): string {
      return config.installHint;
    },
    async getHealthChecks(profile: Profile) {
      const credential = await this.getCredentialStatus(profile);
      return [
        {
          key: `${config.id}-config-dir`,
          label: `${config.displayName} config directory`,
          status: fs.existsSync(profile.configDir) ? "pass" : "fail",
          summary: fs.existsSync(profile.configDir)
            ? `Found ${profile.configDir}`
            : `Missing ${profile.configDir}`,
        },
        {
          key: `${config.id}-auth`,
          label: `${config.displayName} authentication`,
          status: credential.authenticated ? "pass" : credential.expired ? "warn" : "fail",
          summary: credential.authenticated
            ? "Authenticated"
            : credential.expired
              ? "Credentials expired"
              : "Not authenticated",
        },
      ];
    },
    async launch(profile, options) {
      if (config.lifecycle?.launch) return config.lifecycle.launch(profile, options);
      throw new Error("not implemented");
    },
    async terminate(agentProcess) {
      if (config.lifecycle?.terminate) return config.lifecycle.terminate(agentProcess);
      throw new Error("not implemented");
    },
    isRunning(agentProcess) {
      if (config.lifecycle?.isRunning) return config.lifecycle.isRunning(agentProcess);
      throw new Error("not implemented");
    },
    onOutput(agentProcess, handler) {
      if (config.lifecycle?.onOutput) return config.lifecycle.onOutput(agentProcess, handler);
    },
  };
}

// ─── Codex adapter lifecycle ─────────────────────────────────────────

/** Map from AgentProcess pid → ManagedProcessHandle for output streaming and cleanup. */
const codexProcessHandles = new Map<number, ManagedProcessHandle>();

function buildCodexArgs(profile: Profile, userArgs: string[]): string[] {
  const args = ["exec", "--json", "--full-stdout"];

  // Forward approval-mode from profile settings if present
  const approvalMode = profile.envOverrides?.["CODEX_APPROVAL_MODE"];
  if (approvalMode) {
    args.push("--approval-mode", approvalMode);
  }

  // Forward model from profile settings if present
  const model = profile.envOverrides?.["CODEX_MODEL"];
  if (model) {
    args.push("--model", model);
  }

  args.push(...userArgs);
  return args;
}

const codexLifecycle: LifecycleOverrides = {
  async launch(profile: Profile, options: LaunchOptions): Promise<AgentProcess> {
    const binary = "codex";
    const args = buildCodexArgs(profile, options.args);

    if (options.beforeSpawn) {
      await options.beforeSpawn();
    }

    const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
    const handle = spawnManagedProcess({
      command: binary,
      args,
      env,
      cwd: options.cwd,
      component: "codex",
    });

    codexProcessHandles.set(handle.pid, handle);

    // Clean up handle reference when child exits
    handle.child.once("exit", () => {
      codexProcessHandles.delete(handle.pid);
    });

    return {
      pid: handle.pid,
      tool: "codex",
      profile: "default",
      startedAt: new Date(),
    };
  },

  async terminate(agentProcess: AgentProcess): Promise<void> {
    codexProcessHandles.delete(agentProcess.pid);
    await terminateProcess(agentProcess.pid, "codex");
  },

  isRunning(agentProcess: AgentProcess): boolean {
    const alive = isProcessRunning(agentProcess.pid);
    writeLogEvent({
      level: "debug",
      component: "codex",
      action: alive ? "process:alive" : "process:dead",
      message: `pid=${agentProcess.pid}`,
      data: { pid: agentProcess.pid },
    });
    return alive;
  },

  onOutput(agentProcess: AgentProcess, handler: (event: OutputEvent) => void): void {
    const handle = codexProcessHandles.get(agentProcess.pid);
    if (!handle?.child.stdout) {
      writeLogEvent({
        level: "warn",
        component: "codex",
        action: "process:output",
        message: `no stdout stream for pid=${agentProcess.pid}`,
      });
      return;
    }

    const rl = createInterface({ input: handle.child.stdout });
    rl.on("line", (line) => {
      const parsed = parseJsonlLine(line);
      handler({
        type: parsed.type,
        content: parsed.content,
        timestamp: new Date(),
      });
    });
  },
};

// ─── Adapter definitions ─────────────────────────────────────────────

const geminiAdapter = createBasicAdapter({
  id: "gemini",
  displayName: "Gemini CLI",
  dirName: ".gemini",
  markerFiles: ["config.json", "settings.json", "oauth_creds.json"],
  installHint: "See Google's documentation for Gemini CLI installation instructions.",
  credentialReader: readGeminiOAuthCredentials,
  configEnvVar: "GEMINI_CONFIG_DIR",
  capabilities: {
    hooks: false,
    sdkControl: false,
    pluginSystem: false,
    mcpSupport: true,
    jsonOutput: false,
    sandboxing: true,
    processWrap: true,
    remoteSupport: false,
    permissionTier: "interactive",
  },
});

const codexAdapter = createBasicAdapter({
  id: "codex",
  displayName: "Codex CLI",
  dirName: ".codex",
  markerFiles: ["config.json", "config.toml", "auth.json", "settings.json"],
  installHint: "Install with: npm install -g @openai/codex",
  credentialReader: readCodexOAuthCredentials,
  configEnvVar: "CODEX_HOME",
  capabilities: {
    hooks: false,
    sdkControl: false,
    pluginSystem: false,
    mcpSupport: true,
    jsonOutput: true,
    sandboxing: true,
    processWrap: true,
    remoteSupport: false,
    permissionTier: "interactive",
  },
  lifecycle: codexLifecycle,
});

const adapters = new Map<string, RuntimeAdapter>([
  [claudeAdapter.id, claudeAdapter],
  [geminiAdapter.id, geminiAdapter],
  [codexAdapter.id, codexAdapter],
]);

export function listAdapters(): RuntimeAdapter[] {
  return [...adapters.values()];
}

export function getAdapter(tool = "claude"): RuntimeAdapter {
  return adapters.get(tool) ?? createBasicAdapter({
    id: tool,
    displayName: tool,
    dirName: `.${tool}`,
    markerFiles: ["config.json", "settings.json"],
    installHint: `Ensure \"${tool}\" is installed and available on your PATH.`,
  });
}

export function detectToolConfigs(): DetectedTool[] {
  return listAdapters().flatMap((adapter) => adapter.detectConfigs());
}
