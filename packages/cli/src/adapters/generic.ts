/**
 * Generic adapter factory — fallback for any unknown tool name.
 *
 * Provides real process lifecycle (spawn, terminate, health-check, stdout streaming)
 * and periodic health monitoring that logs structured events when a process dies
 * unexpectedly.
 */

import { createInterface } from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { retrieveSecret, writeLogEvent } from "@axiom-labs/arc-core";
import {
  spawnManagedProcess,
  terminateProcess,
  isProcessRunning,
} from "@axiom-labs/arc-core";
import type { Profile } from "@axiom-labs/arc-core";
import type {
  AgentProcess,
  AgentStatus,
  CredentialStatus,
  DetectedTool,
  LaunchOptions,
  OutputEvent,
  RuntimeAdapter,
  AdapterCapabilities,
} from "@axiom-labs/arc-core";
import type { ManagedProcessHandle } from "@axiom-labs/arc-core";

// ─── Constants ───────────────────────────────────────────────────────

const IS_WINDOWS = process.platform === "win32";
const HEALTH_CHECK_INTERVAL_MS = 10_000;

// ─── Internal state ──────────────────────────────────────────────────

/** Map from AgentProcess pid → ManagedProcessHandle for output streaming. */
const genericProcessHandles = new Map<number, ManagedProcessHandle>();

/** Map from AgentProcess pid → health monitor interval timer. */
const healthMonitors = new Map<number, ReturnType<typeof setInterval>>();

// ─── Health monitor ──────────────────────────────────────────────────

function startHealthMonitor(agentProcess: AgentProcess, component: string): void {
  const interval = setInterval(() => {
    const alive = isProcessRunning(agentProcess.pid);

    writeLogEvent({
      level: "debug",
      component,
      action: "health:check",
      message: `pid=${agentProcess.pid} alive=${alive}`,
      data: { pid: agentProcess.pid, alive },
    });

    if (!alive) {
      writeLogEvent({
        level: "warn",
        component,
        action: "health:unexpected-death",
        message: `process pid=${agentProcess.pid} died unexpectedly`,
        data: { pid: agentProcess.pid, tool: agentProcess.tool },
      });
      // Process is dead — stop monitoring
      clearInterval(interval);
      healthMonitors.delete(agentProcess.pid);
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  // Ensure the interval doesn't prevent Node from exiting
  if (interval.unref) {
    interval.unref();
  }

  healthMonitors.set(agentProcess.pid, interval);
}

function stopHealthMonitor(pid: number): void {
  const interval = healthMonitors.get(pid);
  if (interval) {
    clearInterval(interval);
    healthMonitors.delete(pid);
  }
}

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Create a RuntimeAdapter for an unknown/generic tool.
 * Spawns the tool binary with passthrough args, provides stdout line streaming,
 * and runs a periodic health monitor.
 */
export function createGenericAdapter(toolName: string): RuntimeAdapter {
  const component = `generic:${toolName}`;

  const capabilities: AdapterCapabilities = {
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
    id: toolName,
    displayName: toolName,
    capabilities,

    detectConfigs(): DetectedTool[] {
      const configDir = path.join(os.homedir(), `.${toolName}`);
      if (!fs.existsSync(configDir)) return [];
      const hasMarker = ["config.json", "settings.json"].some((f) =>
        fs.existsSync(path.join(configDir, f))
      );
      return hasMarker
        ? [{ tool: toolName, configDir, displayName: toolName }]
        : [];
    },

    async getCredentialStatus(profile: Profile): Promise<CredentialStatus> {
      switch (profile.authType) {
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
            authenticated:
              profile.envOverrides?.["GOOGLE_APPLICATION_CREDENTIALS"] !== undefined,
            authType: "vertex",
            method: "vertex",
          };
        case "foundry":
          return {
            authenticated:
              profile.envOverrides?.["FOUNDRY_API_KEY"] !== undefined,
            authType: "foundry",
            method: "foundry",
          };
        default:
          return {
            authenticated: false,
            authType: profile.authType,
            method: "api-key",
          };
      }
    },

    async buildProfileEnv(profile: Profile): Promise<Record<string, string | undefined>> {
      const env: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(profile.envOverrides ?? {})) {
        env[key] = value;
      }
      return env;
    },

    getInstallHint(): string {
      return `Ensure "${toolName}" is installed and available on your PATH.`;
    },

    async getHealthChecks(profile: Profile) {
      const credential = await this.getCredentialStatus(profile);
      return [
        {
          key: `${toolName}-config-dir`,
          label: `${toolName} config directory`,
          status: fs.existsSync(profile.configDir) ? ("pass" as const) : ("fail" as const),
          summary: fs.existsSync(profile.configDir)
            ? `Found ${profile.configDir}`
            : `Missing ${profile.configDir}`,
        },
        {
          key: `${toolName}-auth`,
          label: `${toolName} authentication`,
          status: credential.authenticated
            ? ("pass" as const)
            : ("fail" as const),
          summary: credential.authenticated ? "Authenticated" : "Not authenticated",
        },
      ];
    },

    // ─── Lifecycle ─────────────────────────────────────────────────

    async launch(profile: Profile, options: LaunchOptions): Promise<AgentProcess> {
      if (options.beforeSpawn) {
        await options.beforeSpawn();
      }

      // On Windows, wrap with cmd /c for .cmd shim resolution
      const command = IS_WINDOWS ? "cmd" : toolName;
      const args = IS_WINDOWS ? ["/c", toolName, ...options.args] : options.args;

      const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
      const handle = spawnManagedProcess({
        command,
        args,
        env,
        cwd: options.cwd,
        component,
      });

      genericProcessHandles.set(handle.pid, handle);

      // Clean up handle reference when child exits
      handle.child.once("exit", () => {
        genericProcessHandles.delete(handle.pid);
      });

      const agentProcess: AgentProcess = {
        pid: handle.pid,
        tool: toolName,
        profile: "default",
        startedAt: new Date(),
      };

      // Start health monitor
      startHealthMonitor(agentProcess, component);

      writeLogEvent({
        level: "info",
        component,
        action: "adapter:launch",
        message: `launched ${toolName} pid=${handle.pid}`,
        data: { pid: handle.pid, tool: toolName },
      });

      return agentProcess;
    },

    async terminate(agentProcess: AgentProcess): Promise<void> {
      // Stop health monitor first
      stopHealthMonitor(agentProcess.pid);
      genericProcessHandles.delete(agentProcess.pid);
      await terminateProcess(agentProcess.pid, component);
    },

    isRunning(agentProcess: AgentProcess): boolean {
      return isProcessRunning(agentProcess.pid);
    },

    onOutput(agentProcess: AgentProcess, handler: (event: OutputEvent) => void): void {
      const handle = genericProcessHandles.get(agentProcess.pid);
      if (!handle?.child.stdout) {
        writeLogEvent({
          level: "warn",
          component,
          action: "process:output",
          message: `no stdout stream for pid=${agentProcess.pid}`,
        });
        return;
      }

      const rl = createInterface({ input: handle.child.stdout });
      rl.on("line", (line) => {
        handler({
          type: "raw",
          content: line,
          timestamp: new Date(),
        });
      });
    },

    async getStatus(agentProcess: AgentProcess): Promise<AgentStatus> {
      const running = isProcessRunning(agentProcess.pid);
      const uptime = running
        ? Date.now() - agentProcess.startedAt.getTime()
        : undefined;
      return {
        running,
        pid: agentProcess.pid,
        uptime,
      };
    },
  };
}

// ─── Test helpers ────────────────────────────────────────────────────

/** Exposed for integration tests only — not part of the public API. */
export const _testInternals = {
  healthMonitors,
  genericProcessHandles,
  HEALTH_CHECK_INTERVAL_MS,
};
