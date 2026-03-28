import { loadConfig } from "../config.js";
import { getCredentialStatus } from "../auth.js";
import { info, stripAnsi } from "../display.js";
import pc from "picocolors";

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
  if (authenticated) {
    return pc.green("authenticated");
  }
  if (expired) {
    return pc.yellow("expired");
  }
  return pc.red("not configured");
}

export async function handleStatus(): Promise<void> {
  const config = loadConfig();
  const names = Object.keys(config.profiles);

  if (names.length === 0) {
    info(
      'No profiles configured. Run "arc profile create <name>" to get started.'
    );
    return;
  }

  const headers = ["Name", "Active", "Tool", "Auth Type", "Status", "Expiry"];
  const rows: string[][] = [];

  for (const name of names) {
    const profile = config.profiles[name];
    const isActive = name === config.activeProfile;

    let status: string;
    let expiry = "";

    try {
      const cred = await getCredentialStatus(profile);
      status = formatAuthStatus(cred.authenticated, cred.expired);
      if (cred.expiresAt !== undefined) {
        const raw = formatExpiry(cred.expiresAt);
        // Show "token refresh needed" instead of confusing "expired Xh ago"
        // when the profile is still authenticated via refresh token
        if (cred.authenticated && cred.expiresAt < Date.now()) {
          expiry = "token auto-refreshes";
        } else {
          expiry = raw;
        }
      }
    } catch {
      status = pc.red("error");
    }

    rows.push([
      name,
      isActive ? "*" : "",
      profile.tool ?? "claude",
      profile.authType,
      status,
      expiry,
    ]);
  }

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i]).length))
  );

  const sep = "  ";
  const headerRow = headers
    .map((h, i) => pc.bold(h.padEnd(colWidths[i])))
    .join(sep);
  const separator = pc.dim(
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
    ["  " + headerRow, "  " + separator, ...dataRows.map((r) => "  " + r)].join("\n") + "\n"
  );
}
