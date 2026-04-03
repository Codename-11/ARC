// ---------------------------------------------------------------------------
// Telemetry types — span, event, exporter, and configuration interfaces
// ---------------------------------------------------------------------------

/**
 * Attributes attached to every span in the ARC trace hierarchy.
 * Well-known keys use the `arc.*` namespace; arbitrary keys are allowed.
 */
export interface SpanAttributes {
  "arc.profile"?: string;
  "arc.adapter"?: string;
  "arc.session_id"?: string;
  "arc.enforcement_mode"?: string;
  "arc.risk_tier"?: string;
  "arc.hook.name"?: string;
  "arc.hook.result"?: string;
  [key: string]: string | number | boolean | undefined;
}

/** A timestamped event recorded within a span. */
export interface SpanEvent {
  name: string;
  timestamp: string;
  attributes?: Record<string, string | number | boolean>;
}

/** Status indicating how the span completed. */
export type SpanStatus = "ok" | "error" | "unset";

/**
 * A single span in the trace tree.
 *
 * Mirrors the OpenTelemetry span model so that a future OTLP exporter
 * can map these 1:1 without transformation.
 */
export interface Span {
  /** Unique span identifier (hex string). */
  id: string;
  /** Trace-wide identifier shared by all spans in the session. */
  traceId: string;
  /** Parent span id, absent for root spans. */
  parentId?: string;
  /** Human-readable span name, e.g. `arc.session` or `arc.hook.risk-detection`. */
  name: string;
  /** ISO-8601 start time. */
  startTime: string;
  /** ISO-8601 end time; undefined while the span is still open. */
  endTime?: string;
  /** Completion status. */
  status: SpanStatus;
  /** Key-value attributes. */
  attributes: SpanAttributes;
  /** Timestamped events recorded during the span's lifetime. */
  events: SpanEvent[];
}

/**
 * An exporter receives completed spans and ships them to a destination.
 * Implementations must be safe to call concurrently.
 */
export interface TraceExporter {
  /** Write a batch of completed spans. */
  export(spans: Span[]): Promise<void>;
  /** Flush any buffered data and release resources. */
  shutdown(): Promise<void>;
}

/** Configuration for the telemetry subsystem. */
export interface TelemetryConfig {
  /** Master switch — when false, no spans are created. */
  enabled: boolean;
  /** Which exporters to activate. */
  exporters: Array<"console" | "json" | "otlp">;
  /** OTLP collector endpoint (gRPC or HTTP). Only used when `otlp` is in `exporters`. */
  otlpEndpoint?: string;
  /** Directory for the JSONL trace file. @default ~/.arc/traces/ */
  jsonPath?: string;
  /** Sampling rate between 0 and 1. @default 1.0 */
  sampleRate: number;
}
