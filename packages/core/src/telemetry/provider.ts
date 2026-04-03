// ---------------------------------------------------------------------------
// TelemetryProvider — in-process span manager and exporter dispatcher
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import type { Span, SpanAttributes, SpanEvent, SpanStatus, TelemetryConfig, TraceExporter } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a 16-byte hex id suitable for span / trace identifiers. */
function generateId(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: TelemetryConfig = {
  enabled: true,
  exporters: ["json"],
  sampleRate: 1.0,
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Manages the lifecycle of spans within a single session.
 *
 * Spans are held in memory until {@link flush} is called, at which point all
 * completed spans are dispatched to the registered {@link TraceExporter}s.
 */
export class TelemetryProvider {
  private readonly config: TelemetryConfig;
  private readonly traceId: string;
  private readonly spans = new Map<string, Span>();
  private readonly exporters: TraceExporter[] = [];

  constructor(config: Partial<TelemetryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.traceId = generateId();
  }

  // -----------------------------------------------------------------------
  // Exporter management
  // -----------------------------------------------------------------------

  /** Register an exporter that will receive spans on {@link flush}. */
  addExporter(exporter: TraceExporter): void {
    this.exporters.push(exporter);
  }

  // -----------------------------------------------------------------------
  // Span lifecycle
  // -----------------------------------------------------------------------

  /**
   * Open a new span.
   *
   * @returns The span id, used for subsequent operations.
   */
  startSpan(
    name: string,
    attributes: SpanAttributes = {},
    parentId?: string,
  ): string {
    if (!this.config.enabled) return "";
    if (this.config.sampleRate < 1 && Math.random() > this.config.sampleRate) return "";

    const id = generateId();
    const span: Span = {
      id,
      traceId: this.traceId,
      parentId,
      name,
      startTime: new Date().toISOString(),
      status: "unset",
      attributes,
      events: [],
    };
    this.spans.set(id, span);
    return id;
  }

  /**
   * Close an open span, optionally setting its status.
   * No-op if the span was already ended or does not exist.
   */
  endSpan(spanId: string, status: SpanStatus = "ok"): void {
    const span = this.spans.get(spanId);
    if (!span || span.endTime) return;
    span.endTime = new Date().toISOString();
    span.status = status;
  }

  /** Record a timestamped event on an open span. */
  addEvent(
    spanId: string,
    event: Omit<SpanEvent, "timestamp"> & { timestamp?: string },
  ): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    span.events.push({
      name: event.name,
      timestamp: event.timestamp ?? new Date().toISOString(),
      attributes: event.attributes,
    });
  }

  /** Set or merge additional attributes on an open span. */
  setAttributes(spanId: string, attrs: SpanAttributes): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    Object.assign(span.attributes, attrs);
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /** Return a snapshot of all currently open (un-ended) spans. */
  getActiveSpans(): ReadonlyArray<Readonly<Span>> {
    return [...this.spans.values()].filter((s) => !s.endTime);
  }

  /** Return a span by id (or undefined). */
  getSpan(spanId: string): Readonly<Span> | undefined {
    return this.spans.get(spanId);
  }

  /** The trace id shared by all spans in this provider. */
  getTraceId(): string {
    return this.traceId;
  }

  // -----------------------------------------------------------------------
  // Flush & shutdown
  // -----------------------------------------------------------------------

  /**
   * Send all completed spans to every registered exporter, then remove them
   * from the in-memory store.
   */
  async flush(): Promise<void> {
    const completed = [...this.spans.values()].filter((s) => s.endTime);
    if (completed.length === 0) return;

    await Promise.allSettled(this.exporters.map((e) => e.export(completed)));

    for (const span of completed) {
      this.spans.delete(span.id);
    }
  }

  /** Flush remaining spans and shut down all exporters. */
  async shutdown(): Promise<void> {
    // End any still-open spans with error status so they aren't lost.
    for (const span of this.spans.values()) {
      if (!span.endTime) {
        span.endTime = new Date().toISOString();
        span.status = "error";
      }
    }

    const flushWithTimeout = Promise.race([
      this.flush(),
      new Promise<void>(resolve => setTimeout(resolve, 5000)),
    ]);
    await flushWithTimeout;
    await Promise.allSettled(this.exporters.map((e) => e.shutdown()));
  }
}
