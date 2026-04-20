import { withDaemonClient } from "../daemon-client.js";
import { error, subtle } from "../display.js";

export interface LsOptions {
  all?: boolean;
  json?: boolean;
}

const HIDDEN_STATUSES = new Set(["completed", "stopped"]);

export async function handleLs(opts: LsOptions = {}): Promise<void> {
  await withDaemonClient(async (client) => {
    try {
      const { agents } = await client.agents.list();
      const visible = opts.all ? agents : agents.filter((a) => !HIDDEN_STATUSES.has(a.status));

      if (opts.json) {
        process.stdout.write(JSON.stringify(visible, null, 2) + "\n");
        return;
      }

      if (visible.length === 0) {
        process.stdout.write(subtle("(no agents)") + "\n");
        return;
      }

      printTable(visible);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });
}

interface AgentRow {
  id: string;
  profile: string;
  status: string;
  updatedAt: number;
}

function printTable(agents: AgentRow[]): void {
  const rows = agents.map((a) => ({
    id: a.id,
    profile: a.profile,
    status: a.status,
    updated: formatTime(a.updatedAt),
  }));

  const cols = [
    { header: "ID", key: "id" as const, min: 2 },
    { header: "PROFILE", key: "profile" as const, min: 7 },
    { header: "STATUS", key: "status" as const, min: 6 },
    { header: "UPDATED", key: "updated" as const, min: 7 },
  ];
  const widths = cols.map((c) => Math.max(c.min, ...rows.map((r) => r[c.key].length)));

  const line = (cells: string[]) =>
    cells.map((v, i) => v.padEnd(widths[i]!)).join("  ") + "\n";

  process.stdout.write(line(cols.map((c) => c.header)));
  for (const r of rows) {
    process.stdout.write(line(cols.map((c) => r[c.key])));
  }
}

function formatTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "-";
  const d = new Date(ts);
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
