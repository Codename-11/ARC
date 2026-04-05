/**
 * TaskDelegator — high-level agent-to-agent task delegation workflow.
 *
 * Sits on top of TaskStore (persistence) and MessageBus (routing) to provide
 * a first-class delegation protocol: create → assign → handoff → work →
 * complete/fail, with validated status transitions and completion callbacks.
 */

import { writeLogEvent } from "../logging.js";
import type { TaskStore } from "./task-store.js";
import type { MessageBus } from "./messaging.js";
import type { Task, TaskStatus, TaskPriority, AgentMessage } from "./types.js";

// ---------------------------------------------------------------------------
// Status transition validation
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  created: ["assigned", "cancelled"],
  assigned: ["working", "cancelled"],
  working: ["completed", "failed", "input-required", "cancelled"],
  "input-required": ["working", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

function assertTransition(current: TaskStatus, next: TaskStatus): void {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw new Error(
      `Invalid status transition: '${current}' → '${next}'. Allowed: [${allowed.join(", ")}]`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DelegationOptions {
  /** Delegating profile name. */
  from: string;
  /** Target profile name (must differ from `from`). */
  to: string;
  /** Task description. */
  description: string;
  priority?: TaskPriority;
  riskTier?: string;
  metadata?: Record<string, unknown>;
  /** Called when the delegated task reaches "completed". */
  onComplete?: (task: Task) => void;
  /** Called when the delegated task reaches "failed". */
  onFailed?: (task: Task) => void;
  /**
   * Optional timeout in milliseconds for the completion listener.
   * When set, the listener is automatically cleaned up after this duration.
   * Prevents memory leaks from tasks that never reach a terminal state.
   */
  listenerTimeoutMs?: number;
}

export interface DelegationResult {
  task: Task;
  message: AgentMessage;
}

// ---------------------------------------------------------------------------
// TaskDelegator
// ---------------------------------------------------------------------------

export class TaskDelegator {
  private taskStore: TaskStore;
  private messageBus: MessageBus;
  /** Tracks unsubscribe functions for completion listeners keyed by task ID. */
  private listeners = new Map<string, () => void>();
  /** Tracks timeout handles for listener TTLs. */
  private timeouts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(taskStore: TaskStore, messageBus: MessageBus) {
    this.taskStore = taskStore;
    this.messageBus = messageBus;
  }

  // -------------------------------------------------------------------------
  // delegate
  // -------------------------------------------------------------------------

  /**
   * Delegate a task from one agent to another.
   *
   * 1. Creates a task with the target as assignee.
   * 2. Transitions to "assigned".
   * 3. Sends a "handoff" message to the target agent.
   * 4. Subscribes to completion/failure notifications if callbacks provided.
   */
  async delegate(options: DelegationOptions): Promise<DelegationResult> {
    const {
      from,
      to,
      description,
      priority,
      riskTier,
      metadata,
      onComplete,
      onFailed,
      listenerTimeoutMs,
    } = options;

    // Guard: self-delegation
    if (from === to) {
      throw new Error(
        `Self-delegation is not allowed: '${from}' cannot delegate to itself.`,
      );
    }

    // 1. Create task
    const task = this.taskStore.create(description, {
      assignee: to,
      priority,
      riskTier,
      metadata: { ...metadata, delegatedBy: from },
    });

    // 2. Transition created → assigned
    assertTransition(task.status, "assigned");
    const assigned = this.taskStore.update(task.id, { status: "assigned" });
    if (!assigned) {
      throw new Error(`Failed to transition task '${task.id}' to assigned.`);
    }

    // 3. Send handoff message
    const message = this.messageBus.send({
      from,
      to,
      content: description,
      type: "handoff",
      taskId: task.id,
    });

    // 4. Subscribe to completion/failure if callbacks provided
    if (onComplete || onFailed) {
      const unsubscribe = this.messageBus.subscribe(from, (msg) => {
        if (msg.taskId !== task.id) return;
        if (msg.type !== "response" && msg.type !== "notification") return;

        const current = this.taskStore.get(task.id);
        if (!current) return;

        if (current.status === "completed" && onComplete) {
          onComplete(current);
          this.cleanupListener(task.id);
        } else if (current.status === "failed" && onFailed) {
          onFailed(current);
          this.cleanupListener(task.id);
        }
      });

      this.listeners.set(task.id, unsubscribe);

      // Set up TTL-based cleanup if configured
      if (listenerTimeoutMs && listenerTimeoutMs > 0) {
        const timeout = setTimeout(() => {
          if (this.listeners.has(task.id)) {
            writeLogEvent({
              level: "warn",
              component: "delegation",
              action: "listener-timeout",
              message: `Listener for task '${task.id}' timed out after ${listenerTimeoutMs}ms — cleaning up`,
              data: { taskId: task.id, timeoutMs: listenerTimeoutMs },
            });
            this.cleanupListener(task.id);
          }
        }, listenerTimeoutMs);
        this.timeouts.set(task.id, timeout);
      }
    }

    writeLogEvent({
      level: "info",
      component: "delegation",
      action: "delegate",
      message: `Task '${task.id}' delegated from '${from}' to '${to}'.`,
      data: { taskId: task.id, from, to, priority: assigned.priority },
    });

    return { task: assigned, message };
  }

  // -------------------------------------------------------------------------
  // accept
  // -------------------------------------------------------------------------

  /**
   * Accept a delegated task (assigned → working).
   * Sends a notification back to the delegator.
   */
  async accept(taskId: string, agent: string): Promise<Task> {
    const task = this.resolveTask(taskId);
    this.assertAssignee(task, agent);
    assertTransition(task.status, "working");

    const updated = this.taskStore.update(taskId, { status: "working" });
    if (!updated) throw new Error(`Failed to update task '${taskId}'.`);

    // Notify the delegator
    const delegator = this.getDelegator(task);
    if (delegator) {
      this.messageBus.send({
        from: agent,
        to: delegator,
        content: "Task accepted",
        type: "notification",
        taskId,
      });
    }

    writeLogEvent({
      level: "info",
      component: "delegation",
      action: "accept",
      message: `Task '${taskId}' accepted by '${agent}'.`,
      data: { taskId, agent },
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // complete
  // -------------------------------------------------------------------------

  /**
   * Complete a delegated task with output.
   * Sends a response message to the delegator with the output.
   */
  async complete(taskId: string, agent: string, output: string): Promise<Task> {
    const task = this.resolveTask(taskId);
    this.assertAssignee(task, agent);
    assertTransition(task.status, "completed");

    const updated = this.taskStore.update(taskId, { status: "completed", output });
    if (!updated) throw new Error(`Failed to update task '${taskId}'.`);

    const delegator = this.getDelegator(task);
    if (delegator) {
      this.messageBus.send({
        from: agent,
        to: delegator,
        content: output,
        type: "response",
        taskId,
      });
    }

    writeLogEvent({
      level: "info",
      component: "delegation",
      action: "complete",
      message: `Task '${taskId}' completed by '${agent}'.`,
      data: { taskId, agent },
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // fail
  // -------------------------------------------------------------------------

  /**
   * Fail a delegated task with a reason.
   * Sends a response message to the delegator with the failure reason.
   */
  async fail(taskId: string, agent: string, reason: string): Promise<Task> {
    const task = this.resolveTask(taskId);
    this.assertAssignee(task, agent);
    assertTransition(task.status, "failed");

    const updated = this.taskStore.update(taskId, { status: "failed", output: reason });
    if (!updated) throw new Error(`Failed to update task '${taskId}'.`);

    const delegator = this.getDelegator(task);
    if (delegator) {
      this.messageBus.send({
        from: agent,
        to: delegator,
        content: reason,
        type: "response",
        taskId,
      });
    }

    writeLogEvent({
      level: "info",
      component: "delegation",
      action: "fail",
      message: `Task '${taskId}' failed by '${agent}': ${reason}`,
      data: { taskId, agent, reason },
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // requestInput
  // -------------------------------------------------------------------------

  /**
   * Request more input from the delegator.
   * Transitions to "input-required" and sends a request message.
   */
  async requestInput(taskId: string, agent: string, question: string): Promise<Task> {
    const task = this.resolveTask(taskId);
    this.assertAssignee(task, agent);
    assertTransition(task.status, "input-required");

    const updated = this.taskStore.update(taskId, { status: "input-required" });
    if (!updated) throw new Error(`Failed to update task '${taskId}'.`);

    const delegator = this.getDelegator(task);
    if (delegator) {
      this.messageBus.send({
        from: agent,
        to: delegator,
        content: question,
        type: "request",
        taskId,
      });
    }

    writeLogEvent({
      level: "info",
      component: "delegation",
      action: "request-input",
      message: `Task '${taskId}': '${agent}' requested input.`,
      data: { taskId, agent, question },
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // provideInput
  // -------------------------------------------------------------------------

  /**
   * Provide input to a task that is waiting for it (input-required → working).
   * Called by the delegator to unblock the assignee. Sends the response as
   * a "response" message to the assignee.
   */
  async provideInput(taskId: string, from: string, response: string): Promise<Task> {
    const task = this.resolveTask(taskId);

    // Validate the caller is the delegator
    const delegator = this.getDelegator(task);
    if (delegator !== from) {
      throw new Error(
        `Agent '${from}' is not the delegator of task '${taskId}' (delegator: '${delegator ?? "none"}').`,
      );
    }

    assertTransition(task.status, "working");

    const updated = this.taskStore.update(taskId, { status: "working" });
    if (!updated) throw new Error(`Failed to update task '${taskId}'.`);

    // Send the input to the assignee
    if (task.assignee) {
      this.messageBus.send({
        from,
        to: task.assignee,
        content: response,
        type: "response",
        taskId,
      });
    }

    writeLogEvent({
      level: "info",
      component: "delegation",
      action: "provide-input",
      message: `Task '${taskId}': '${from}' provided input, task resumed.`,
      data: { taskId, from, assignee: task.assignee },
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Query helpers
  // -------------------------------------------------------------------------

  /** List tasks delegated BY a specific agent. */
  delegatedBy(agent: string): Task[] {
    return this.taskStore.list().filter(
      (t) => t.metadata?.delegatedBy === agent,
    );
  }

  /** List tasks delegated TO a specific agent. */
  delegatedTo(agent: string): Task[] {
    return this.taskStore.list({ assignee: agent }).filter(
      (t) => t.metadata?.delegatedBy !== undefined,
    );
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Clean up all active listeners and timeouts.
   * Call this when the delegator is being destroyed or the session ends.
   */
  dispose(): void {
    for (const taskId of [...this.listeners.keys()]) {
      this.cleanupListener(taskId);
    }

    writeLogEvent({
      level: "info",
      component: "delegation",
      action: "dispose",
      message: `TaskDelegator disposed — ${this.listeners.size} listener(s) cleaned up.`,
    });
  }

  /** Number of active completion listeners. */
  get activeListenerCount(): number {
    return this.listeners.size;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Resolve a task by ID, throwing if not found. */
  private resolveTask(taskId: string): Task {
    const task = this.taskStore.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found.`);
    return task;
  }

  /** Assert the agent is the task assignee. */
  private assertAssignee(task: Task, agent: string): void {
    if (task.assignee !== agent) {
      throw new Error(
        `Agent '${agent}' is not the assignee of task '${task.id}' (assignee: '${task.assignee ?? "none"}').`,
      );
    }
  }

  /** Extract the delegator profile name from task metadata. */
  private getDelegator(task: Task): string | undefined {
    return task.metadata?.delegatedBy as string | undefined;
  }

  /** Remove listener and timeout for a task. */
  private cleanupListener(taskId: string): void {
    const unsubscribe = this.listeners.get(taskId);
    if (unsubscribe) {
      unsubscribe();
      this.listeners.delete(taskId);
    }

    const timeout = this.timeouts.get(taskId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(taskId);
    }
  }
}
