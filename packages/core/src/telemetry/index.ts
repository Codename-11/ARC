// Telemetry barrel — re-exports types, provider, span helpers, and exporters.

export type {
  SpanAttributes,
  SpanEvent,
  SpanStatus,
  Span,
  TraceExporter,
  TelemetryConfig,
} from "./types.js";

export { TelemetryProvider } from "./provider.js";

export {
  startSessionSpan,
  startPreflightSpan,
  startHookSpan,
  startAgentExecutionSpan,
  startToolUseSpan,
  startPostflightSpan,
  startCircuitBreakerSpan,
} from "./spans.js";

export {
  ConsoleExporter,
  JsonFileExporter,
  OtlpExporter,
} from "./exporters.js";
