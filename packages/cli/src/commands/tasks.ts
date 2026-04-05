/**
 * arc tasks — CLI commands for task management.
 *
 * Subcommands: list, create, update, stop, output
 */
import pc from "picocolors";
import { TaskStore } from "@axiom-labs/arc-core";
import type { TaskStatus, TaskPriority } from "@axiom-labs/arc-core";

const store = new TaskStore();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<string, (s: string) => string> = {
  created: pc.blue,
  assigned: pc.cyan,
  working: pc.yellow,
  "input-required": pc.magenta,
  completed: pc.green,
  failed: pc.red,
  cancelled: pc.dim,
};

const PRIORITY_COLOR: Record<string, (s: string) => string> = {
  low: pc.dim,
  medium: pc.white,
  high: pc.yellow,
  critical: pc.red,
};

function formatStatus(status: string): string {
  const color = STATUS_COLOR[status] ?? pc.white;
  return color(status);
}

function formatPriority(priority: string): string {
  const color = PRIORITY_COLOR[priority] ?? pc.white;
  return color(priority);
}

function shortId(id: string): string {
  return id.slice(0, 8);
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

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleTasksList(opts: {
  status?: string;
  assignee?: string;
  json?: boolean;
}): Promise<void> {
  const tasks = store.list({
    status: opts.status as TaskStatus | undefined,
    assignee: opts.assignee,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(tasks, null, 2) + "\n");
    return;
  }

  if (tasks.length === 0) {
    process.stdout.write("No tasks found.\n");
    return;
  }

  // Table header
  const idW = 10;
  const statusW = 16;
  const priW = 10;
  const assignW = 14;
  const updW = 10;

  process.stdout.write(
    `  ${"ID".padEnd(idW)}${pc.dim("│")} ${"Status".padEnd(statusW)}${pc.dim("│")} ${"Priority".padEnd(priW)}${pc.dim("│")} ${"Assignee".padEnd(assignW)}${pc.dim("│")} ${"Updated".padEnd(updW)}${pc.dim("│")} Description\n`,
  );
  process.stdout.write(
    `  ${"─".repeat(idW)}${"┼"}${"─".repeat(statusW + 1)}${"┼"}${"─".repeat(priW + 1)}${"┼"}${"─".repeat(assignW + 1)}${"┼"}${"─".repeat(updW + 1)}${"┼"}${"─".repeat(30)}\n`,
  );

  for (const task of tasks) {
    const id = pc.dim(shortId(task.id));
    const status = formatStatus(task.status).padEnd(statusW + 10); // account for ANSI
    const pri = formatPriority(task.priority);
    const assignee = (task.assignee ?? pc.dim("—")).padEnd(assignW);
    const updated = pc.dim(relativeTime(task.updated));
    const desc = task.description.length > 40
      ? task.description.slice(0, 37) + "..."
      : task.description;

    process.stdout.write(
      `  ${id.padEnd(idW + 10)}${pc.dim("│")} ${status}${pc.dim("│")} ${pri.padEnd(priW + 10)}${pc.dim("│")} ${assignee}${pc.dim("│")} ${updated.padEnd(updW + 10)}${pc.dim("│")} ${desc}\n`,
    );
  }

  process.stdout.write(pc.dim(`\n  ${tasks.length} task(s) total.\n`));
}

export async function handleTasksCreate(
  description: string,
  opts: {
    priority?: string;
    assignee?: string;
  },
): Promise<void> {
  const task = store.create(description, {
    priority: (opts.priority as TaskPriority) ?? "medium",
    assignee: opts.assignee,
  });

  process.stdout.write(pc.green("Task created") + "\n");
  process.stdout.write(`  ID:          ${pc.dim(task.id)}\n`);
  process.stdout.write(`  Priority:    ${formatPriority(task.priority)}\n`);
  if (task.assignee) {
    process.stdout.write(`  Assignee:    ${task.assignee}\n`);
  }
  process.stdout.write(`  Description: ${task.description}\n`);
}

export async function handleTasksUpdate(
  id: string,
  opts: {
    status?: string;
    assignee?: string;
    priority?: string;
  },
): Promise<void> {
  const fields: Record<string, unknown> = {};
  if (opts.status) fields.status = opts.status;
  if (opts.assignee) fields.assignee = opts.assignee;
  if (opts.priority) fields.priority = opts.priority;

  if (Object.keys(fields).length === 0) {
    process.stderr.write(pc.red("No update fields specified.") + "\n");
    process.exit(1);
  }

  const task = store.update(id, fields);
  if (!task) {
    process.stderr.write(pc.red(`Task '${id}' not found.`) + "\n");
    process.exit(1);
  }

  process.stdout.write(pc.green("Task updated") + ` ${pc.dim(shortId(task.id))}\n`);
  if (opts.status) process.stdout.write(`  Status:   ${formatStatus(task.status)}\n`);
  if (opts.assignee) process.stdout.write(`  Assignee: ${task.assignee}\n`);
  if (opts.priority) process.stdout.write(`  Priority: ${formatPriority(task.priority)}\n`);
}

export async function handleTasksStop(id: string): Promise<void> {
  const task = store.stop(id);
  if (!task) {
    process.stderr.write(pc.red(`Task '${id}' not found.`) + "\n");
    process.exit(1);
  }

  process.stdout.write(pc.yellow("Task cancelled") + ` ${pc.dim(shortId(task.id))}\n`);
}

export async function handleTasksOutput(
  id: string,
  text?: string,
): Promise<void> {
  if (text) {
    const task = store.addOutput(id, text);
    if (!task) {
      process.stderr.write(pc.red(`Task '${id}' not found.`) + "\n");
      process.exit(1);
    }
    process.stdout.write(pc.green("Output appended") + ` to ${pc.dim(shortId(task.id))}\n`);
  } else {
    const task = store.get(id);
    if (!task) {
      process.stderr.write(pc.red(`Task '${id}' not found.`) + "\n");
      process.exit(1);
    }
    if (!task.output) {
      process.stdout.write(pc.dim("No output recorded.\n"));
      return;
    }
    process.stdout.write(task.output + "\n");
  }
}
