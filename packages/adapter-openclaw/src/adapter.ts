import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  RuntimeAdapter,
  AdapterCapabilities,
  DetectedTool,
  CredentialStatus,
  AdapterHealthCheck,
  AgentProcess,
  LaunchOptions,
} from "@axiom-labs/arc-core";
import type { Profile } from "@axiom-labs/arc-core";

const OPENCLAW_DIR = ".openclaw";
const MARKER_FILES = ["main.toml", "main.json", "settings.json"];

const openclawCapabilities: AdapterCapabilities = {
  pluginSystem: true,
  processWrap: false,
  hooks: true,
  sdkControl: false,
  mcpSupport: false,
  jsonOutput: false,
  sandboxing: false,
  remoteSupport: false,
  permissionTier: "interactive",
};

export const openclawAdapter: RuntimeAdapter = {
  id: "openclaw",
  displayName: "OpenClaw",
  capabilities: openclawCapabilities,

  detectConfigs(): DetectedTool[] {
    const configDir = path.join(os.homedir(), OPENCLAW_DIR);
    if (!fs.existsSync(configDir)) return [];
    const hasMarker = MARKER_FILES.some((file) =>
      fs.existsSync(path.join(configDir, file))
    );
    return hasMarker
      ? [{ tool: "openclaw", configDir, displayName: "OpenClaw" }]
      : [];
  },

  async getCredentialStatus(
    profile: Profile,
    _profileName?: string
  ): Promise<CredentialStatus> {
    // OpenClaw uses upstream provider credentials (e.g. Anthropic, OpenAI),
    // not its own auth. Presence of a config directory means the tool is
    // configured; credential validity depends on the underlying provider.
    const configDir = path.join(os.homedir(), OPENCLAW_DIR);
    const configured = fs.existsSync(configDir);
    return {
      authenticated: configured,
      authType: profile.authType,
      method: profile.envOverrides ? "env-var" : "api-key",
    };
  },

  async buildProfileEnv(
    profile: Profile,
    _profileName: string
  ): Promise<Record<string, string | undefined>> {
    const env: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(profile.envOverrides ?? {})) {
      env[key] = value;
    }
    return env;
  },

  getInstallHint(_binaryName?: string): string {
    return [
      "Install OpenClaw and the ARC plugin:",
      "  npm install -g openclaw",
      "  openclaw plugins install @axiom-labs/arc-adapter-openclaw",
    ].join("\n");
  },

  async getHealthChecks(
    profile: Profile,
    _profileName?: string
  ): Promise<AdapterHealthCheck[]> {
    const configDir = path.join(os.homedir(), OPENCLAW_DIR);
    const configExists = fs.existsSync(configDir);
    const credential = await this.getCredentialStatus(profile);
    return [
      {
        key: "openclaw-config-dir",
        label: "OpenClaw config directory",
        status: configExists ? "pass" : "fail",
        summary: configExists
          ? `Found ${configDir}`
          : `Missing ${configDir}`,
      },
      {
        key: "openclaw-auth",
        label: "OpenClaw authentication",
        status: credential.authenticated ? "pass" : "fail",
        summary: credential.authenticated
          ? "Configured (uses provider credentials)"
          : "Not configured",
      },
    ];
  },

  async launch(_profile: Profile, _options: LaunchOptions): Promise<AgentProcess> {
    throw new Error(
      "OpenClaw uses a plugin-based architecture — the ARC adapter runs " +
        "inside the OpenClaw Gateway process, not as a standalone process.\n\n" +
        "To use ARC with OpenClaw:\n" +
        "  1. npm install -g openclaw\n" +
        "  2. openclaw plugins install @axiom-labs/arc-adapter-openclaw\n" +
        "  3. Start the OpenClaw Gateway: openclaw start"
    );
  },

  async terminate(_process: AgentProcess): Promise<void> {
    // No-op: the OpenClaw Gateway manages its own lifecycle.
  },

  isRunning(_process: AgentProcess): boolean {
    // Cannot determine Gateway status without an OpenClaw runtime dependency.
    return false;
  },
};
