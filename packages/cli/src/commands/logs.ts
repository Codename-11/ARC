import pc from "picocolors";
import { getLogEntries } from "../log.js";

export async function handleLogs(opts: {
  limit?: string | number;
  level?: "debug" | "info" | "warn" | "error";
  component?: string;
  profile?: string;
  json?: boolean;
}): Promise<void> {
  const limit = typeof opts.limit === "string" ? Number.parseInt(opts.limit, 10) : opts.limit;
  const entries = getLogEntries({
    limit: Number.isFinite(limit) ? limit : undefined,
    level: opts.level,
    component: opts.component,
    profile: opts.profile,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
    return;
  }

  if (entries.length === 0) {
    process.stdout.write("No log entries found.\n");
    return;
  }

  for (const entry of entries) {
    const levelColor =
      entry.level === "error"
        ? pc.red
        : entry.level === "warn"
          ? pc.yellow
          : entry.level === "debug"
            ? pc.cyan
            : pc.green;

    process.stdout.write(
      `${pc.dim(entry.timestamp)} ${levelColor(entry.level.toUpperCase())} ${entry.component} ${entry.action}` +
        `${entry.profile ? ` [${entry.profile}]` : ""}` +
        `${entry.detail ?? entry.message ? ` - ${entry.detail ?? entry.message}` : ""}\n`
    );
  }
}
