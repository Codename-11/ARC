/**
 * MessageBus — in-memory inter-agent message routing for ARC Phase 17.
 */

import crypto from "node:crypto";
import { writeLogEvent } from "../logging.js";
import type { AgentMessage, MessageType } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageHandler = (message: AgentMessage) => void;

export interface SendOptions {
  from: string;
  to: string;
  content: string;
  type: MessageType;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// MessageBus
// ---------------------------------------------------------------------------

export class MessageBus {
  /** Per-recipient message queue. */
  private queues = new Map<string, AgentMessage[]>();
  /** Per-recipient subscription handlers. */
  private subscribers = new Map<string, MessageHandler[]>();

  /** Send a message. Queues it for the recipient and notifies subscribers. */
  send(options: SendOptions): AgentMessage {
    const message: AgentMessage = {
      id: crypto.randomUUID(),
      from: options.from,
      to: options.to,
      content: options.content,
      type: options.type,
      taskId: options.taskId,
      timestamp: new Date().toISOString(),
      metadata: options.metadata,
    };

    // Enqueue
    if (!this.queues.has(message.to)) {
      this.queues.set(message.to, []);
    }
    this.queues.get(message.to)!.push(message);

    // Notify subscribers
    const handlers = this.subscribers.get(message.to);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(message);
        } catch {
          // Subscriber errors must not crash the bus.
        }
      }
    }

    writeLogEvent({
      level: "info",
      component: "messaging",
      action: "send",
      message: `Message from '${message.from}' to '${message.to}' (${message.type}).`,
      data: { messageId: message.id, type: message.type, taskId: message.taskId },
    });

    return message;
  }

  /**
   * Receive and drain all queued messages for `to`.
   * Returns messages in FIFO order and clears the queue.
   */
  receive(to: string): AgentMessage[] {
    const queue = this.queues.get(to);
    if (!queue || queue.length === 0) return [];

    const messages = [...queue];
    queue.length = 0;

    writeLogEvent({
      level: "info",
      component: "messaging",
      action: "receive",
      message: `Drained ${messages.length} message(s) for '${to}'.`,
      data: { recipient: to, count: messages.length },
    });

    return messages;
  }

  /**
   * Subscribe to messages for a specific recipient.
   * Returns an unsubscribe function.
   */
  subscribe(to: string, handler: MessageHandler): () => void {
    if (!this.subscribers.has(to)) {
      this.subscribers.set(to, []);
    }
    this.subscribers.get(to)!.push(handler);

    return () => {
      const handlers = this.subscribers.get(to);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index !== -1) handlers.splice(index, 1);
      }
    };
  }
}
