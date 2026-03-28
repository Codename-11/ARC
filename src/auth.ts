import fs from "node:fs";
import path from "node:path";
import type { AuthType, Profile } from "./types.js";
import { retrieveSecret } from "./keyring.js";

export interface CredentialStatus {
  authenticated: boolean;
  authType: AuthType;
  email?: string;
  accountTier?: string;
  expiresAt?: number;
  expired?: boolean;
  method: "oauth" | "api-key" | "env-var" | "bedrock" | "vertex" | "foundry";
}

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  subscriptionType?: string;
  rateLimitTier?: string;
}

/**
 * Format account tier from credential data.
 * rateLimitTier like "default_claude_max_20x" → "max (20x)"
 * Falls back to subscriptionType like "max" → "max"
 */
function formatAccountTier(creds: OAuthCredentials): string | undefined {
  if (creds.rateLimitTier) {
    // "default_claude_max_20x" → "max (20x)"
    const match = creds.rateLimitTier.match(/([a-z]+)_(\d+x)$/);
    if (match) {
      return `${match[1]} (${match[2]})`;
    }
    // "default_claude_pro" → "pro"
    const planMatch = creds.rateLimitTier.match(/([a-z]+)$/);
    if (planMatch && planMatch[1] !== "default") {
      return planMatch[1];
    }
  }
  return creds.subscriptionType;
}

/** Read a JSON file and return the parsed object, or null on any failure. */
function readJsonFile(filePath: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed JSON
  }
  return null;
}

/**
 * Read Claude Code OAuth credentials from `.credentials.json`.
 * Format: `{ claudeAiOauth | oauthAccount: { accessToken, refreshToken, expiresAt, ... } }`
 */
export function readClaudeOAuthCredentials(
  configDir: string
): OAuthCredentials | null {
  const obj = readJsonFile(path.join(configDir, ".credentials.json"));
  if (!obj) return null;

  const oauthData = obj["claudeAiOauth"] ?? obj["oauthAccount"];
  if (typeof oauthData !== "object" || oauthData === null) return null;

  const creds = oauthData as Record<string, unknown>;
  const accessToken = creds["accessToken"];
  const refreshToken = creds["refreshToken"];
  const expiresAt = creds["expiresAt"];

  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    typeof expiresAt !== "number"
  ) {
    return null;
  }

  const subscriptionType = creds["subscriptionType"];
  const rateLimitTier = creds["rateLimitTier"];
  return {
    accessToken,
    refreshToken,
    expiresAt,
    subscriptionType: typeof subscriptionType === "string" ? subscriptionType : undefined,
    rateLimitTier: typeof rateLimitTier === "string" ? rateLimitTier : undefined,
  };
}

/**
 * Read Gemini CLI OAuth credentials from `oauth_creds.json`.
 * Format: `{ access_token, refresh_token, expiry_date }`
 */
function readGeminiOAuthCredentials(
  configDir: string
): OAuthCredentials | null {
  const obj = readJsonFile(path.join(configDir, "oauth_creds.json"));
  if (!obj) return null;

  const accessToken = obj["access_token"];
  const refreshToken = obj["refresh_token"];
  const expiryDate = obj["expiry_date"];

  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    typeof expiryDate !== "number"
  ) {
    return null;
  }

  return { accessToken, refreshToken, expiresAt: expiryDate };
}

/**
 * Read Codex CLI OAuth credentials from `auth.json`.
 * Format: `{ auth_mode, tokens: { access_token, refresh_token, ... } }`
 */
function readCodexOAuthCredentials(
  configDir: string
): OAuthCredentials | null {
  const obj = readJsonFile(path.join(configDir, "auth.json"));
  if (!obj) return null;

  const tokens = obj["tokens"];
  if (typeof tokens !== "object" || tokens === null) return null;

  const t = tokens as Record<string, unknown>;
  const accessToken = t["access_token"];
  const refreshToken = t["refresh_token"];

  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    return null;
  }

  // Decode the JWT access_token to extract the `exp` claim (seconds since epoch)
  let expiresAt = Infinity;
  try {
    const payload = accessToken.split(".")[1];
    if (payload) {
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (typeof decoded.exp === "number") {
        expiresAt = decoded.exp * 1000; // convert seconds → milliseconds
      }
    }
  } catch {
    // Malformed JWT — fall through with Infinity
  }

  return { accessToken, refreshToken, expiresAt };
}

/**
 * Read OAuth credentials for the given tool, falling back across formats.
 * Tries the tool-specific file first, then falls back to Claude's format as a default.
 */
export function readOAuthCredentials(
  configDir: string,
  tool?: string
): OAuthCredentials | null {
  switch (tool) {
    case "gemini":
      return readGeminiOAuthCredentials(configDir) ?? readClaudeOAuthCredentials(configDir);
    case "codex":
      return readCodexOAuthCredentials(configDir) ?? readClaudeOAuthCredentials(configDir);
    default:
      return readClaudeOAuthCredentials(configDir);
  }
}

export async function getCredentialStatus(
  profile: Profile,
  tool?: string
): Promise<CredentialStatus> {
  const resolvedTool = tool ?? profile.tool;
  switch (profile.authType) {
    case "oauth": {
      const creds = readOAuthCredentials(profile.configDir, resolvedTool);
      if (!creds) {
        return {
          authenticated: false,
          authType: "oauth",
          method: "oauth",
        };
      }
      // A valid refresh token means the tool can auto-refresh the access token,
      // so the profile is authenticated even if the access token is expired.
      const hasRefreshToken = creds.refreshToken.length > 0;
      const accessTokenExpired = creds.expiresAt < Date.now();
      return {
        authenticated: hasRefreshToken,
        authType: "oauth",
        expiresAt: Number.isFinite(creds.expiresAt) ? creds.expiresAt : undefined,
        expired: hasRefreshToken ? false : accessTokenExpired,
        method: "oauth",
        accountTier: formatAccountTier(creds),
      };
    }

    case "api-key": {
      // Check env overrides first
      if (profile.envOverrides?.["ANTHROPIC_API_KEY"]) {
        return {
          authenticated: true,
          authType: "api-key",
          method: "env-var",
        };
      }
      // Check keyring
      const secret = await retrieveSecret(profile.configDir.split(path.sep).pop() ?? "");
      if (secret) {
        return {
          authenticated: true,
          authType: "api-key",
          method: "api-key",
        };
      }
      return {
        authenticated: false,
        authType: "api-key",
        method: "api-key",
      };
    }

    case "bedrock": {
      const hasOverrides =
        profile.envOverrides?.["AWS_ACCESS_KEY_ID"] !== undefined ||
        profile.envOverrides?.["AWS_PROFILE"] !== undefined;
      return {
        authenticated: hasOverrides,
        authType: "bedrock",
        method: "bedrock",
      };
    }

    case "vertex": {
      const hasOverrides =
        profile.envOverrides?.["GOOGLE_APPLICATION_CREDENTIALS"] !== undefined ||
        profile.envOverrides?.["CLOUD_ML_REGION"] !== undefined;
      return {
        authenticated: hasOverrides,
        authType: "vertex",
        method: "vertex",
      };
    }

    case "foundry": {
      const hasOverrides =
        profile.envOverrides?.["FOUNDRY_API_KEY"] !== undefined;
      return {
        authenticated: hasOverrides,
        authType: "foundry",
        method: "foundry",
      };
    }
  }
}

// Env vars that select Claude Code's auth mode — must be sanitized to prevent
// cross-profile contamination when the parent shell has leftovers from another profile.
const CLAUDE_AUTH_ENV_VARS = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "ANTHROPIC_FOUNDRY_RESOURCE",
] as const;

export async function buildProfileEnv(
  profile: Profile,
  profileName: string
): Promise<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = {
    CLAUDE_CONFIG_DIR: profile.configDir,
  };

  // Explicitly unset all auth-related env vars so parent-process values
  // from a different profile don't leak into the child process.
  for (const key of CLAUDE_AUTH_ENV_VARS) {
    env[key] = undefined;
  }

  switch (profile.authType) {
    case "api-key": {
      const secret = await retrieveSecret(profileName);
      if (secret) {
        env["ANTHROPIC_API_KEY"] = secret;
      }
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
    case "oauth":
      // OAuth uses credentials file in configDir, no extra env needed
      break;
  }

  if (profile.envOverrides) {
    for (const [key, value] of Object.entries(profile.envOverrides)) {
      env[key] = value;
    }
  }

  return env;
}
