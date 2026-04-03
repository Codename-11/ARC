// ---------------------------------------------------------------------------
// Span helpers — pre-configured span constructors for the ARC trace hierarchy
// ---------------------------------------------------------------------------
//
// Span hierarchy (from SPEC.md §10):
//
//   arc.session
//     ├── arc.preflight
//     │   ├── arc.hook.source-classify
//     │   ├── arc.hook.risk-detection
//     │   └── arc.hook.interagent-routing
//     ├── arc.agent.execution
//     │   ├── arc.tool.use
//     │   └── arc.agent.output
//     ├── arc.postflight
//     │   ├── arc.hook.audit-score
//     │   ├── arc.hook.post-verify
//     │   └── arc.hook.memory-sync
//     └── arc.circuit-breaker
// ---------------------------------------------------------------------------

import type { TelemetryProvider } from "./provider.js";

// ---------------------------------------------------------------------------
// Root span
// ---------------------------------------------------------------------------

/**
 * Start the root session span. All other spans in this session should descend
 * from it.
 */
export function startSessionSpan(
  provider: TelemetryProvider,
  sessionId: string,
  profile: string,
  adapter: string,
  enforcement: string,
): string {
  return provider.startSpan("arc.session", {
    "arc.session_id": sessionId,
    "arc.profile": profile,
    "arc.adapter": adapter,
    "arc.enforcement_mode": enforcement,
  });
}

// ---------------------------------------------------------------------------
// Preflight pipeline
// ---------------------------------------------------------------------------

/** Start the preflight pipeline span. */
export function startPreflightSpan(
  provider: TelemetryProvider,
  parentId: string,
): string {
  return provider.startSpan("arc.preflight", {}, parentId);
}

/**
 * Start a span for an individual hook execution within a pipeline.
 *
 * @param hookName  The hook identifier, e.g. `source-classify`.
 */
export function startHookSpan(
  provider: TelemetryProvider,
  parentId: string,
  hookName: string,
): string {
  return provider.startSpan(`arc.hook.${hookName}`, {
    "arc.hook.name": hookName,
  }, parentId);
}

// ---------------------------------------------------------------------------
// Agent execution
// ---------------------------------------------------------------------------

/** Start the agent execution span. */
export function startAgentExecutionSpan(
  provider: TelemetryProvider,
  parentId: string,
): string {
  return provider.startSpan("arc.agent.execution", {}, parentId);
}

/** Start a span for a single tool invocation within agent execution. */
export function startToolUseSpan(
  provider: TelemetryProvider,
  parentId: string,
  toolName: string,
): string {
  return provider.startSpan("arc.tool.use", {
    "arc.tool.name": toolName,
  }, parentId);
}

// ---------------------------------------------------------------------------
// Postflight pipeline
// ---------------------------------------------------------------------------

/** Start the postflight pipeline span. */
export function startPostflightSpan(
  provider: TelemetryProvider,
  parentId: string,
): string {
  return provider.startSpan("arc.postflight", {}, parentId);
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

/**
 * Start a circuit-breaker span when the breaker trips.
 *
 * @param failures  The number of consecutive failures that caused the trip.
 */
export function startCircuitBreakerSpan(
  provider: TelemetryProvider,
  parentId: string,
  failures: number,
): string {
  return provider.startSpan("arc.circuit-breaker", {
    "arc.circuit_breaker.failures": failures,
  }, parentId);
}
