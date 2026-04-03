import fs from "node:fs";
import path from "node:path";
import type { CredentialStatus } from "../../core/src/adapters/types.js";
import type { Profile } from "../../core/src/types.js";
import { retrieveSecret } from "../../core/src/keyring.js";

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  subscriptionType?: string;
  rateLimitTier?: string;
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function formatAccountTier(creds: OAuthCredentials): string | undefined {
  if (creds.rateLimitTier) {
    const match = creds.rateLimitTier.match(/([a-z]+)_(\d+x)$/);
    if (match) {
      return `${match[1]} (${match[2]})`;
    }
    const fallback = creds.rateLimitTier.match(/([a-z]+)$/);
    if (fallback && fallback[1] !== "default") {
      return fallback[1];
    }
  }
  return creds.subscriptionType;
}

export function readClaudeOAuthCredentials(configDir: string): OAuthCredentials | null {
  const obj = readJsonFile(path.join(configDir, ".credentials.json"));
  if (!obj) return null;

  const oauthData = obj["claudeAiOauth"] ?? obj["oauthAccount"];
  if (typeof oauthData !== "object" || oauthData === null) return null;

  const creds = oauthData as Record<string, unknown>;
  if (
    typeof creds["accessToken"] !== "string" ||
    typeof creds["refreshToken"] !== "string" ||
    typeof creds["expiresAt"] !== "number"
  ) {
    return null;
  }

  return {
    accessToken: creds["accessToken"],
    refreshToken: creds["refreshToken"],
    expiresAt: creds["expiresAt"],
    subscriptionType:
      typeof creds["subscriptionType"] === "string" ? creds["subscriptionType"] : undefined,
    rateLimitTier:
      typeof creds["rateLimitTier"] === "string" ? creds["rateLimitTier"] : undefined,
  };
}

export async function getClaudeCredentialStatus(profile: Profile): Promise<CredentialStatus> {
  switch (profile.authType) {
    case "oauth": {
      const creds = readClaudeOAuthCredentials(profile.configDir);
      if (!creds) {
        return {
          authenticated: false,
          authType: "oauth",
          method: "oauth",
        };
      }

      const hasRefreshToken = creds.refreshToken.length > 0;
      return {
        authenticated: hasRefreshToken,
        authType: "oauth",
        expiresAt: creds.expiresAt,
        expired: hasRefreshToken ? false : creds.expiresAt < Date.now(),
        method: "oauth",
        accountTier: formatAccountTier(creds),
      };
    }
    case "api-key": {
      if (profile.envOverrides?.["ANTHROPIC_API_KEY"]) {
        return {
          authenticated: true,
          authType: "api-key",
          method: "env-var",
        };
      }
      const secret = await retrieveSecret(profile.configDir.split(path.sep).pop() ?? "");
      return {
        authenticated: Boolean(secret),
        authType: "api-key",
        method: "api-key",
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
          profile.envOverrides?.["GOOGLE_APPLICATION_CREDENTIALS"] !== undefined ||
          profile.envOverrides?.["CLOUD_ML_REGION"] !== undefined,
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
}

const CLAUDE_AUTH_ENV_VARS = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "ANTHROPIC_FOUNDRY_RESOURCE",
] as const;

export async function buildClaudeProfileEnv(
  profile: Profile,
  profileName: string
): Promise<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = {
    CLAUDE_CONFIG_DIR: profile.configDir,
  };

  for (const key of CLAUDE_AUTH_ENV_VARS) {
    env[key] = undefined;
  }

  switch (profile.authType) {
    case "api-key": {
      const secret = await retrieveSecret(profileName);
      if (secret) env["ANTHROPIC_API_KEY"] = secret;
      break;
    }
    case "bedrock":
      env["CLAUDE_CODE_USE_BEDROCK"] = "1";
      break;
    case "vertex":
      env["CLAUDE_CODE_USE_VERTEX"] = "1";
      break;
    case "foundry":
      env["CLAUDE_CODE_USE_FOUNDRY"] = "1";
      break;
    default:
      break;
  }

  Object.assign(env, profile.envOverrides ?? {});
  return env;
}
