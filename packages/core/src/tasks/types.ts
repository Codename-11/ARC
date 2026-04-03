/**
 * Task management types for ARC Phase 17.
 *
 * Defines Task, AgentMessage, and CronJob interfaces used by the
 * task store, message bus, and cron scheduler.
 */

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export type TaskStatus =
  | "created"
  | "assigned"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  /** Profile name this task is assigned to. */
  assignee?: string;
  priority: TaskPriority;
  riskTier?: string;
  created: string;
  updated: string;
  output?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Agent messaging
// ---------------------------------------------------------------------------

export type MessageType = "request" | "response" | "notification" | "handoff";

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  type: MessageType;
  taskId?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Cron jobs
// ---------------------------------------------------------------------------

export interface CronJob {
  id: string;
  name: string;
  /** Cron expression in standard `minute hour day month weekday` format. */
  schedule: string;
  taskTemplate: Partial<Task>;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
}
