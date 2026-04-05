/**
 * arc auth — Multi-account OAuth management for ARC profiles.
 *
 * Subcommands: status, login, refresh, whoami
 */
import { spawnSync } from "node:child_process";
import pc from "picocolors";
import { loadConfig, resolveProfile } from "../config.js";
import {
  getCredentialStatus,
  readOAuthCredentials,
  buildProfileEnv,
} from "../auth.js";
import { info, error, success, warn, stripAnsi } from "../display.js";
import type { Profile, AuthType } from "../types.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function formatExpiry(expiresAt: number): string {
  const now = Date.now();
  const diff = expiresAt - now;
  const absDiff = Math.abs(diff);

  const minutes = Math.floor(absDiff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let timeStr: string;
  if (days > 0) {
    timeStr = `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    timeStr = `${hours}h ${minutes % 60}m`;
  } else {
    timeStr = `${minutes}m`;
  }

  return diff > 0 ? `expires in ${timeStr}` : `expired ${timeStr} ago`;
}

function formatAuthStatus(
  authenticated: boolean,
  expired?: boolean
): string {
  if (authenticated) return pc.green("authenticated");
  if (expired) return pc.yellow("expired");
  return pc.red("not configured");
}

function formatMethod(method: string): string {
  switch (method) {
    case "oauth":
      return "oauth";
    case "api-key":
      return "api-key";
    case "env-var":
      return "api-key " + pc.dim("(env)");
    case "bedrock":
      return "bedrock";
    case "vertex":
      return "vertex";
    case "foundry":
      return "foundry";
    default:
      return method;
  }
}

/** Resolve login command for a given tool. */
function getLoginCommand(tool: string): { cmd: string; args: string[] } | null {
  switch (tool) {
    case "claude":
      return { cmd: "claude", args: ["auth", "login"] };
    case "gemini":
      return { cmd: "gemini", args: ["auth", "login"] };
    case "codex":
      return { cmd: "codex", args: ["auth", "login"] };
    default:
      return null;
  }
}

/** Resolve refresh command for a given tool (if supported). */
function getRefreshCommand(tool: string): { cmd: string; args: string[] } | null {
  switch (tool) {
    case "claude":
      // Claude Code doesn't have an explicit refresh subcommand;
      // launching with auth will auto-refresh if needed
      return null;
    case "gemini":
      return null;
    case "codex":
      return null;
    default:
      return null;
  }
}

interface StatusRow {
  name: string;
  tool: string;
  authType: string;
  status: string;
  account: string;
  expiry: string;
}

async function buildStatusRow(
  name: string,
  profile: Profile,
  isActive: boolean
): Promise<StatusRow> {
  const tool = profile.tool ?? "claude";
  const row: StatusRow = {
    name: isActive ? pc.bold(name) + " " + pc.dim("*") : name,
    tool,
    authType: profile.authType,
    status: "",
    account: "",
    expiry: "",
  };

  try {
    const cred = await getCredentialStatus(profile, tool);
    row.status = formatAuthStatus(cred.authenticated, cred.expired);
    row.authType = formatMethod(cred.method);

    // Account info
    if (cred.accountTier) {
      row.account = cred.accountTier;
    } else if (cred.method === "api-key" || cred.method === "env-var") {
      row.account = cred.authenticated ? "API key" : pc.dim("--");
    } else if (cred.method === "bedrock") {
      row.account = cred.authenticated ? "AWS" : pc.dim("--");
    } else if (cred.method === "vertex") {
      row.account = cred.authenticated ? "GCP" : pc.dim("--");
    } else if (cred.method === "foundry") {
      row.account = cred.authenticated ? "Foundry" : pc.dim("--");
    } else {
      row.account = pc.dim("--");
    }

    // Expiry
    if (cred.expiresAt !== undefined) {
      if (cred.authenticated && cred.expiresAt < Date.now()) {
        row.expiry = pc.dim("auto-refreshes");
      } else {
        const raw = formatExpiry(cred.expiresAt);
        row.expiry = cred.expiresAt < Date.now() ? pc.red(raw) : pc.dim(raw);
      }
    } else {
      row.expiry = pc.dim("--");
    }
  } catch {
    row.status = pc.red("error");
    row.account = pc.dim("--");
    row.expiry = pc.dim("--");
  }

  return row;
}

function printTable(headers: string[], rows: string[][]): void {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i]).length))
  );

  const sep = "  ";
  const headerRow = headers
    .map((h, i) => pc.bold(h.padEnd(colWidths[i])))
    .join(sep);
  const divider = pc.dim(
    colWidths.map((w) => "\u2500".repeat(w)).join(sep)
  );
  const dataRows = rows.map((row) =>
    row
      .map((cell, i) => {
        const visible = stripAnsi(cell).length;
        const pad = colWidths[i] - visible;
        return cell + " ".repeat(Math.max(0, pad));
      })
      .join(sep)
  );

  process.stdout.write(
    ["  " + headerRow, "  " + divider, ...dataRows.map((r) => "  " + r)].join(
      "\n"
    ) + "\n"
  );
}

// ─── arc auth status [profile] ────────────────────────────────────────

interface StatusOptions {
  json?: boolean;
}

export async function handleAuthStatus(
  profileName?: string,
  opts: StatusOptions = {}
): Promise<void> {
  const config = loadConfig();

  // Single profile detail view
  if (profileName) {
    const raw = config.profiles[profileName];
    if (!raw) {
      error(`Profile "${profileName}" not found.`);
      process.exit(1);
    }

    let profile: Profile;
    try {
      profile = resolveProfile(config, profileName);
    } catch (e) {
      error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }

    const tool = profile.tool ?? "claude";
    const cred = await getCredentialStatus(profile, tool);
    const oauthCreds = cred.method === "oauth"
      ? readOAuthCredentials(profile.configDir, tool)
      : null;

    if (opts.json) {
      const jsonOutput = {
        profile: profileName,
        tool,
        authType: profile.authType,
        method: cred.method,
        authenticated: cred.authenticated,
        expired: cred.expired ?? null,
        accountTier: cred.accountTier ?? null,
        expiresAt: cred.expiresAt ?? null,
        subscriptionType: oauthCreds?.subscriptionType ?? null,
        rateLimitTier: oauthCreds?.rateLimitTier ?? null,
        configDir: profile.configDir,
      };
      process.stdout.write(JSON.stringify(jsonOutput, null, 2) + "\n");
      return;
    }

    console.log();
    console.log(
      "  " + pc.bold(profileName) + " " + pc.dim(`(${tool})`)
    );
    console.log("  " + pc.dim("\u2500".repeat(40)));
    console.log(
      "  Auth type:    " + formatMethod(cred.method)
    );
    console.log(
      "  Status:       " + formatAuthStatus(cred.authenticated, cred.expired)
    );

    if (cred.accountTier) {
      console.log("  Account tier: " + cred.accountTier);
    }

    if (oauthCreds?.subscriptionType) {
      console.log(
        "  Subscription: " + oauthCreds.subscriptionType
      );
    }
    if (oauthCreds?.rateLimitTier) {
      console.log(
        "  Rate limit:   " + pc.dim(oauthCreds.rateLimitTier)
      );
    }

    if (cred.expiresAt !== undefined) {
      const expiryStr = formatExpiry(cred.expiresAt);
      if (cred.authenticated && cred.expiresAt < Date.now()) {
        console.log(
          "  Token:        " + pc.dim("access token expired, auto-refreshes via refresh token")
        );
      } else {
        console.log(
          "  Token:        " +
            (cred.expiresAt < Date.now() ? pc.red(expiryStr) : expiryStr)
        );
      }
      console.log(
        "  Expires at:   " +
          pc.dim(new Date(cred.expiresAt).toISOString())
      );
    }

    console.log(
      "  Config dir:   " + pc.dim(profile.configDir)
    );
    console.log();
    return;
  }

  // All profiles overview
  const names = Object.keys(config.profiles);
  if (names.length === 0) {
    info(
      'No profiles configured. Run "arc create <name>" to get started.'
    );
    return;
  }

  const statusRows: StatusRow[] = [];
  for (const name of names) {
    let profile: Profile;
    try {
      profile = resolveProfile(config, name);
    } catch {
      // If resolution fails, use the raw profile for basic info
      profile = config.profiles[name];
    }
    const isActive = name === config.activeProfile;
    statusRows.push(await buildStatusRow(name, profile, isActive));
  }

  if (opts.json) {
    const jsonOutput = statusRows.map((r) => ({
      name: stripAnsi(r.name).replace(/\s*\*$/, "").trim(),
      tool: r.tool,
      authType: stripAnsi(r.authType),
      status: stripAnsi(r.status),
      account: stripAnsi(r.account),
      expiry: stripAnsi(r.expiry),
    }));
    process.stdout.write(JSON.stringify(jsonOutput, null, 2) + "\n");
    return;
  }

  console.log();
  const headers = ["Profile", "Tool", "Auth", "Status", "Account", "Expiry"];
  const rows = statusRows.map((r) => [
    r.name,
    r.tool,
    r.authType,
    r.status,
    r.account,
    r.expiry,
  ]);
  printTable(headers, rows);
  console.log();
}

// ─── arc auth login <profile> ─────────────────────────────────────────

export async function handleAuthLogin(profileName: string): Promise<void> {
  const config = loadConfig();
  const raw = config.profiles[profileName];
  if (!raw) {
    error(`Profile "${profileName}" not found.`);
    process.exit(1);
  }

  let profile: Profile;
  try {
    profile = resolveProfile(config, profileName);
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const tool = profile.tool ?? "claude";
  const loginCmd = getLoginCommand(tool);

  if (!loginCmd) {
    error(
      `No login command known for tool "${tool}". Please log in manually.`
    );
    process.exit(1);
  }

  if (profile.authType !== "oauth") {
    warn(
      `Profile "${profileName}" uses ${profile.authType} auth, not OAuth.`
    );
    info(
      profile.authType === "api-key"
        ? `Use "arc set-key ${profileName}" to configure an API key instead.`
        : `Configure ${profile.authType} auth via profile envOverrides.`
    );
    return;
  }

  info(
    `Launching ${pc.bold(loginCmd.cmd)} login for profile "${profileName}"...`
  );
  info(pc.dim(`Config dir: ${profile.configDir}`));
  console.log();

  // Build profile-isolated environment
  const profileEnv = await buildProfileEnv(profile, profileName);
  const mergedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) mergedEnv[key] = value;
  }
  for (const [key, value] of Object.entries(profileEnv)) {
    if (value === undefined) {
      delete mergedEnv[key];
    } else {
      mergedEnv[key] = value;
    }
  }

  const result = spawnSync(loginCmd.cmd, loginCmd.args, {
    stdio: "inherit",
    env: mergedEnv,
    shell: true,
  });

  console.log();

  if (result.error) {
    error(
      `Failed to run "${loginCmd.cmd} ${loginCmd.args.join(" ")}": ${result.error.message}`
    );
    info(
      `Make sure "${loginCmd.cmd}" is installed and on your PATH.`
    );
    process.exit(1);
  }

  if (result.status !== 0) {
    warn(
      `Login process exited with code ${result.status}.`
    );
  }

  // Verify credentials after login
  const cred = await getCredentialStatus(profile, tool);
  if (cred.authenticated) {
    success(
      `Profile "${profileName}" is now authenticated.` +
        (cred.accountTier ? ` [${cred.accountTier}]` : "")
    );
  } else {
    warn(
      `Credentials not detected after login. You may need to complete the login flow in your browser.`
    );
  }
}

// ─── arc auth refresh <profile> ───────────────────────────────────────

export async function handleAuthRefresh(profileName: string): Promise<void> {
  const config = loadConfig();
  const raw = config.profiles[profileName];
  if (!raw) {
    error(`Profile "${profileName}" not found.`);
    process.exit(1);
  }

  let profile: Profile;
  try {
    profile = resolveProfile(config, profileName);
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const tool = profile.tool ?? "claude";

  if (profile.authType !== "oauth") {
    warn(
      `Profile "${profileName}" uses ${profile.authType} auth — token refresh is only applicable to OAuth.`
    );
    return;
  }

  const oauthCreds = readOAuthCredentials(profile.configDir, tool);
  if (!oauthCreds) {
    error(
      `No OAuth credentials found for profile "${profileName}". Run "arc auth login ${profileName}" first.`
    );
    process.exit(1);
  }

  const hasRefreshToken = oauthCreds.refreshToken.length > 0;
  const accessExpired = oauthCreds.expiresAt < Date.now();

  console.log();
  console.log(
    "  " + pc.bold(profileName) + " " + pc.dim(`(${tool})`)
  );
  console.log("  " + pc.dim("\u2500".repeat(40)));

  if (hasRefreshToken) {
    console.log(
      "  Refresh token: " + pc.green("present")
    );
  } else {
    console.log(
      "  Refresh token: " + pc.red("missing")
    );
  }

  if (Number.isFinite(oauthCreds.expiresAt)) {
    console.log(
      "  Access token:  " +
        (accessExpired ? pc.yellow("expired") : pc.green("valid")) +
        " " +
        pc.dim(`(${formatExpiry(oauthCreds.expiresAt)})`)
    );
    console.log(
      "  Expires at:    " +
        pc.dim(new Date(oauthCreds.expiresAt).toISOString())
    );
  }

  // Try tool-specific refresh command
  const refreshCmd = getRefreshCommand(tool);
  if (refreshCmd) {
    info(`Running ${refreshCmd.cmd} ${refreshCmd.args.join(" ")}...`);

    const profileEnv = await buildProfileEnv(profile, profileName);
    const mergedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) mergedEnv[key] = value;
    }
    for (const [key, value] of Object.entries(profileEnv)) {
      if (value === undefined) {
        delete mergedEnv[key];
      } else {
        mergedEnv[key] = value;
      }
    }

    const result = spawnSync(refreshCmd.cmd, refreshCmd.args, {
      stdio: "inherit",
      env: mergedEnv,
      shell: true,
    });

    if (result.error || result.status !== 0) {
      warn("Refresh command did not succeed.");
    }
  } else {
    // No explicit refresh command available
    console.log();
    if (hasRefreshToken && accessExpired) {
      info(
        "The access token is expired but a refresh token is present."
      );
      info(
        `The tool will auto-refresh on next launch. Run "arc launch ${profileName}" to trigger it.`
      );
    } else if (hasRefreshToken && !accessExpired) {
      success("Access token is still valid. No refresh needed.");
    } else if (!hasRefreshToken) {
      warn(
        `No refresh token found. Run "arc auth login ${profileName}" to re-authenticate.`
      );
    }
  }

  console.log();
}

// ─── arc auth whoami [profile] ────────────────────────────────────────

interface WhoamiOptions {
  json?: boolean;
}

export async function handleAuthWhoami(
  profileName?: string,
  opts: WhoamiOptions = {}
): Promise<void> {
  const config = loadConfig();
  const resolvedName = profileName ?? config.activeProfile;

  const raw = config.profiles[resolvedName];
  if (!raw) {
    error(`Profile "${resolvedName}" not found.`);
    process.exit(1);
  }

  let profile: Profile;
  try {
    profile = resolveProfile(config, resolvedName);
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const tool = profile.tool ?? "claude";
  const cred = await getCredentialStatus(profile, tool);

  if (opts.json) {
    const jsonOutput = {
      profile: resolvedName,
      tool,
      authType: profile.authType,
      method: cred.method,
      authenticated: cred.authenticated,
      accountTier: cred.accountTier ?? null,
    };
    process.stdout.write(JSON.stringify(jsonOutput, null, 2) + "\n");
    return;
  }

  const statusStr = cred.authenticated
    ? pc.green("authenticated")
    : pc.red("not authenticated");

  const tierStr = cred.accountTier
    ? ` [${cred.accountTier}]`
    : "";

  const methodStr = formatMethod(cred.method);

  console.log(
    `${pc.bold(resolvedName)} \u2192 ${tool} (${methodStr}) ${statusStr}${tierStr}`
  );
}
