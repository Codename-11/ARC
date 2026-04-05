import fs from "node:fs";
import path from "node:path";
import type { CredentialStatus, Profile } from "@axiom-labs/arc-core";
import { getAdapter } from "./adapters/index.js";

export type { CredentialStatus } from "@axiom-labs/arc-core";

export async function getCredentialStatus(
  profile: Profile,
  tool?: string
): Promise<CredentialStatus> {
  return await getAdapter(tool ?? profile.tool ?? "claude").getCredentialStatus(profile);
}

export async function buildProfileEnv(
  profile: Profile,
  profileName: string
): Promise<Record<string, string | undefined>> {
  return await getAdapter(profile.tool ?? "claude").buildProfileEnv(profile, profileName);
}

// ── OAuth credential reading (used by `arc auth` command) ─────────────

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  subscriptionType?: string;
  rateLimitTier?: string;
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

  let expiresAt = Infinity;
  try {
    const payload = accessToken.split(".")[1];
    if (payload) {
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (typeof decoded.exp === "number") {
        expiresAt = decoded.exp * 1000;
      }
    }
  } catch {
    // Malformed JWT
  }

  return { accessToken, refreshToken, expiresAt };
}

/**
 * Read OAuth credentials for the given tool, falling back across formats.
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
