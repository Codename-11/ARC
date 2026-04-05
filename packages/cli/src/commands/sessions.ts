/**
 * arc sessions — CLI commands for session management.
 *
 * Subcommands: list, resume, complete
 */
import pc from "picocolors";
import { SessionStore } from "@axiom-labs/arc-core";
import type { SessionStatus } from "@axiom-labs/arc-core";

const store = new SessionStore();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<string, (s: string) => string> = {
  active: pc.green,
  suspended: pc.yellow,
  completed: pc.dim,
};

function formatStatus(status: string): string {
  const color = STATUS_COLOR[status] ?? pc.white;
  return color(status);
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleSessionsList(opts: {
  status?: string;
  profile?: string;
  json?: boolean;
}): Promise<void> {
  const sessions = store.list({
    status: opts.status as SessionStatus | undefined,
    profile: opts.profile,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(sessions, null, 2) + "\n");
    return;
  }

  if (sessions.length === 0) {
    process.stdout.write(pc.dim("No sessions found.\n"));
    return;
  }

  const idW = 10;
  const nameW = Math.max(6, ...sessions.map((s) => s.name.length)) + 2;
  const profileW = Math.max(8, ...sessions.map((s) => s.profile.length)) + 2;
  const adapterW = Math.max(8, ...sessions.map((s) => s.adapter.length)) + 2;
  const statusW = 12;
  const activeW = 12;

  process.stdout.write(
    `  ${"ID".padEnd(idW)}${pc.dim("│")} ${"Name".padEnd(nameW)}${pc.dim("│")} ${"Profile".padEnd(profileW)}${pc.dim("│")} ${"Adapter".padEnd(adapterW)}${pc.dim("│")} ${"Status".padEnd(statusW)}${pc.dim("│")} Last Active\n`,
  );
  process.stdout.write(
    pc.dim(`  ${"─".repeat(idW)}┼${"─".repeat(nameW + 1)}┼${"─".repeat(profileW + 1)}┼${"─".repeat(adapterW + 1)}┼${"─".repeat(statusW + 1)}┼${"─".repeat(activeW)}`) + "\n",
  );

  for (const session of sessions) {
    const id = pc.dim(shortId(session.id));
    const name = session.name;
    const profile = session.profile;
    const adapter = session.adapter;
    const status = formatStatus(session.status);
    const lastActive = pc.dim(relativeTime(session.lastActive));

    process.stdout.write(
      `  ${id.padEnd(idW + 10)}${pc.dim("│")} ${name.padEnd(nameW)}${pc.dim("│")} ${profile.padEnd(profileW)}${pc.dim("│")} ${adapter.padEnd(adapterW)}${pc.dim("│")} ${status.padEnd(statusW + 10)}${pc.dim("│")} ${lastActive}\n`,
    );
  }

  process.stdout.write(pc.dim(`\n  ${sessions.length} session(s) total.\n`));
}

export async function handleSessionsResume(id?: string): Promise<void> {
  let sessionId = id;

  if (!sessionId) {
    const last = store.getLastSuspended();
    if (!last) {
      process.stderr.write(pc.red("No suspended sessions to resume.") + "\n");
      process.exit(1);
    }
    sessionId = last.id;
    process.stdout.write(pc.dim(`Resuming last suspended session: ${last.name}`) + "\n");
  }

  try {
    const session = store.resume(sessionId);
    process.stdout.write(pc.green("Session resumed") + "\n");
    process.stdout.write(`  Name:    ${session.name}\n`);
    process.stdout.write(`  Profile: ${session.profile}\n`);
    process.stdout.write(`  Adapter: ${session.adapter}\n`);
    process.stdout.write(`  Status:  ${formatStatus(session.status)}\n`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(pc.red(msg) + "\n");
    process.exit(1);
  }
}

export async function handleSessionsComplete(id: string): Promise<void> {
  try {
    const session = store.complete(id);
    process.stdout.write(pc.green("Session completed") + ` ${pc.dim(shortId(session.id))}\n`);
    process.stdout.write(`  Name:    ${session.name}\n`);
    process.stdout.write(`  Profile: ${session.profile}\n`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(pc.red(msg) + "\n");
    process.exit(1);
  }
}
