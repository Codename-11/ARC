/**
 * TaskStore — JSON file-backed task persistence at ~/.arc/tasks/tasks.json.
 *
 * Provides CRUD operations with audit logging via writeLogEvent.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getArcDir } from "../paths.js";
import { writeLogEvent } from "../logging.js";
import type { Task, TaskStatus, TaskPriority } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTasksDir(): string {
  return path.join(getArcDir(), "tasks");
}

function getTasksPath(): string {
  return path.join(getTasksDir(), "tasks.json");
}

interface TasksFile {
  tasks: Task[];
}

function readTasks(): Task[] {
  const filePath = getTasksPath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as TasksFile;
    return Array.isArray(data.tasks) ? data.tasks : [];
  } catch {
    return [];
  }
}

function writeTasks(tasks: Task[]): void {
  const dir = getTasksDir();
  fs.mkdirSync(dir, { recursive: true });
  const data: TasksFile = { tasks };
  fs.writeFileSync(getTasksPath(), JSON.stringify(data, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

export interface TaskListFilters {
  status?: TaskStatus;
  assignee?: string;
  priority?: TaskPriority;
}

export interface TaskCreateOptions {
  assignee?: string;
  priority?: TaskPriority;
  riskTier?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// TaskStore
// ---------------------------------------------------------------------------

export class TaskStore {
  /** Create a new task. Returns the created task. */
  create(description: string, options?: TaskCreateOptions): Task {
    const tasks = readTasks();
    const now = new Date().toISOString();

    const task: Task = {
      id: crypto.randomUUID(),
      description,
      status: "created",
      assignee: options?.assignee,
      priority: options?.priority ?? "medium",
      riskTier: options?.riskTier,
      created: now,
      updated: now,
      metadata: options?.metadata,
    };

    tasks.push(task);
    writeTasks(tasks);

    writeLogEvent({
      level: "info",
      component: "tasks",
      action: "create",
      message: `Task '${task.id}' created: ${description}`,
      data: { taskId: task.id, priority: task.priority },
    });

    return task;
  }

  /** Get a task by ID. Returns undefined if not found. */
  get(id: string): Task | undefined {
    return readTasks().find((t) => t.id === id);
  }

  /** List tasks, optionally filtered by status, assignee, or priority. */
  list(filters?: TaskListFilters): Task[] {
    let tasks = readTasks();

    if (filters?.status) {
      tasks = tasks.filter((t) => t.status === filters.status);
    }
    if (filters?.assignee) {
      tasks = tasks.filter((t) => t.assignee === filters.assignee);
    }
    if (filters?.priority) {
      tasks = tasks.filter((t) => t.priority === filters.priority);
    }

    return tasks;
  }

  /** Update fields on an existing task. Returns the updated task or undefined. */
  update(id: string, fields: Partial<Omit<Task, "id" | "created">>): Task | undefined {
    const tasks = readTasks();
    const index = tasks.findIndex((t) => t.id === id);
    if (index === -1) return undefined;

    const updated: Task = {
      ...tasks[index],
      ...fields,
      id: tasks[index].id,
      created: tasks[index].created,
      updated: new Date().toISOString(),
    };
    tasks[index] = updated;
    writeTasks(tasks);

    writeLogEvent({
      level: "info",
      component: "tasks",
      action: "update",
      message: `Task '${id}' updated.`,
      data: { taskId: id, fields: Object.keys(fields) },
    });

    return updated;
  }

  /** Stop a task by setting its status to 'cancelled'. */
  stop(id: string): Task | undefined {
    return this.update(id, { status: "cancelled" });
  }

  /** Append output to a task. */
  addOutput(id: string, output: string): Task | undefined {
    const task = this.get(id);
    if (!task) return undefined;

    const existing = task.output ?? "";
    const combined = existing ? `${existing}\n${output}` : output;

    return this.update(id, { output: combined });
  }

  /**
   * Remove completed, failed, or cancelled tasks older than `maxAge` ms.
   * Defaults to 7 days.
   */
  prune(maxAge?: number): number {
    const cutoff = Date.now() - (maxAge ?? 7 * 24 * 60 * 60 * 1000);
    const tasks = readTasks();
    const terminal: TaskStatus[] = ["completed", "failed", "cancelled"];

    const remaining = tasks.filter((t) => {
      if (!terminal.includes(t.status)) return true;
      return new Date(t.updated).getTime() > cutoff;
    });

    const pruned = tasks.length - remaining.length;
    if (pruned > 0) {
      writeTasks(remaining);
      writeLogEvent({
        level: "info",
        component: "tasks",
        action: "prune",
        message: `Pruned ${pruned} task(s).`,
        data: { pruned, remaining: remaining.length },
      });
    }

    return pruned;
  }
}
