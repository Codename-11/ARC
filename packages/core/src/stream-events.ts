import type { PermissionTier } from "./adapters/types.js";
import type { AgentPhase } from "./phase-indicators.js";

// ─── Event types ────────────────────────────────────────────────────

export type StreamEvent =
  | { type: "message_start"; sessionId: string; turn: number }
  | { type: "command_match"; command: string; confidence: number }
  | { type: "tool_match"; tool: string; confidence: number }
  | { type: "permission_check"; tool: string; tier: PermissionTier; result: "allow" | "deny" | "ask" }
  | { type: "message_delta"; content: string }
  | { type: "message_stop"; reason: string }
  | { type: "compaction"; turnsBefore: number; turnsAfter: number; tokensSaved: number }
  | { type: "phase_change"; phase: AgentPhase }
  | { type: "stuck_detected"; strategy: string }
  | { type: "circuit_break"; failures: number };

/** Extract the `type` string literal from the StreamEvent union. */
export type StreamEventType = StreamEvent["type"];

/** Narrow a StreamEvent to a specific type. */
export type StreamEventOf<T extends StreamEventType> = Extract<StreamEvent, { type: T }>;

/** Handler function for a specific event type. */
export type StreamEventHandler<T extends StreamEventType = StreamEventType> = (
  event: StreamEventOf<T>,
) => void;

// ─── StreamEventBus ─────────────────────────────────────────────────

/**
 * A simple typed event bus for streaming agent events.
 *
 * Supports per-type subscription (`on`/`off`) and broadcast (`emit`).
 * Handlers are invoked synchronously in registration order.
 */
export class StreamEventBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers = new Map<StreamEventType, Array<(event: any) => void>>();

  /** Subscribe to events of a specific type. */
  on<T extends StreamEventType>(
    type: T,
    handler: StreamEventHandler<T>,
  ): void {
    const list = this.handlers.get(type);
    if (list) {
      list.push(handler);
    } else {
      this.handlers.set(type, [handler]);
    }
  }

  /** Unsubscribe a previously registered handler. */
  off<T extends StreamEventType>(
    type: T,
    handler: StreamEventHandler<T>,
  ): void {
    const list = this.handlers.get(type);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
    if (list.length === 0) {
      this.handlers.delete(type);
    }
  }

  /** Emit an event, invoking all handlers registered for its type. */
  emit(event: StreamEvent): void {
    const list = this.handlers.get(event.type);
    if (!list) return;
    for (const handler of list) {
      handler(event);
    }
  }

  /** Remove all handlers for all event types. */
  clear(): void {
    this.handlers.clear();
  }
}
