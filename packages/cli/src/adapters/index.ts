import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import claudeAdapter from "@axiom-labs/arc-adapter-claude";
import { retrieveSecret } from "@axiom-labs/arc-core";
import type { Profile } from "@axiom-labs/arc-core";
import type {
  CredentialStatus,
  DetectedTool,
  RuntimeAdapter,
} from "@axiom-labs/arc-core";

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

function createBasicAdapter(config: {
  id: string;
  displayName: string;
  dirName: string;
  markerFiles: string[];
  installHint: string;
  credentialReader?: (configDir: string) => OAuthCredentials | null;
  configEnvVar?: string;
}): RuntimeAdapter {
  return {
    id: config.id,
    displayName: config.displayName,
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
  };
}

const geminiAdapter = createBasicAdapter({
  id: "gemini",
  displayName: "Gemini CLI",
  dirName: ".gemini",
  markerFiles: ["config.json", "settings.json", "oauth_creds.json"],
  installHint: "See Google's documentation for Gemini CLI installation instructions.",
  credentialReader: readGeminiOAuthCredentials,
  configEnvVar: "GEMINI_CONFIG_DIR",
});

const codexAdapter = createBasicAdapter({
  id: "codex",
  displayName: "Codex CLI",
  dirName: ".codex",
  markerFiles: ["config.json", "config.toml", "auth.json", "settings.json"],
  installHint: "Install with: npm install -g @openai/codex",
  credentialReader: readCodexOAuthCredentials,
  configEnvVar: "CODEX_HOME",
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
