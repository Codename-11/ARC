import { writeLogEvent } from "../logging.js";
import type {
  Hook,
  HookContext,
  HookResult,
  AgentResponse,
} from "./types.js";

// ─── Public interfaces ───────────────────────────────────────────────

/** Result of a single health-check probe. */
export interface HealthCheckResult {
  /** Service name (e.g. "gateway", "watchdog"). */
  name: string;
  /** Whether the service is healthy. */
  healthy: boolean;
  /** Optional detail string (latency, version, error message). */
  detail?: string;
}

/** Options for createPostVerifyHook factory. */
export interface PostVerifyOptions {
  /**
   * Pluggable health check function. Called when a service operation is
   * detected. Returns an array of health-check results.
   * Default: returns [] (no endpoints to poll — pass-through).
   */
  healthCheckFn?: () => Promise<HealthCheckResult[]>;
  /** Maximum time to spend polling health, in ms. Default: 30 000. */
  pollTimeoutMs?: number;
  /** Initial poll interval in ms (doubles on each retry). Default: 1 000. */
  pollIntervalMs?: number;
}

// ─── Constants ───────────────────────────────────────────────────────

const HOOK_NAME = "post-verify";
const COMPONENT = `hook:${HOOK_NAME}`;

/**
 * Word-boundary regex patterns that indicate a service operation was
 * performed in the agent response. V1 intentionally broad — "deploy" in
 * "explain deployment" still matches. Tightening is a future refinement.
 */
const SERVICE_OP_PATTERNS = [
  /\brestart(?:ed|s|ing)?\b/i,
  /\bdeploy(?:ed|s|ing|ment)?\b/i,
  /\bconfig\s*change[ds]?\b/i,
  /\bservice\s*reload(?:ed|s|ing)?\b/i,
];

/** Default health check — no endpoints, immediate pass-through. */
const DEFAULT_HEALTH_CHECK: () => Promise<HealthCheckResult[]> = async () => [];

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Detect whether the agent response describes a service operation
 * (restart, deploy, config change, service reload).
 */
export function detectServiceOperation(content: string): boolean {
  if (!content) return false;
  return SERVICE_OP_PATTERNS.some((re) => re.test(content));
}

/**
 * Sleep for `ms` milliseconds. Returns a promise that resolves after the
 * delay. Accepts an AbortSignal so callers can cancel early.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Poll `healthCheckFn` with exponential backoff until all services report
 * healthy or the timeout is reached. Returns the last set of results.
 */
async function pollHealth(
  healthCheckFn: () => Promise<HealthCheckResult[]>,
  pollIntervalMs: number,
  pollTimeoutMs: number,
): Promise<{ results: HealthCheckResult[]; timedOut: boolean }> {
  const deadline = Date.now() + pollTimeoutMs;
  let interval = pollIntervalMs;
  let lastResults: HealthCheckResult[] = [];

  while (Date.now() < deadline) {
    lastResults = await healthCheckFn();

    // If every probe is healthy (or no probes), we're done.
    if (lastResults.length === 0 || lastResults.every((r) => r.healthy)) {
      return { results: lastResults, timedOut: false };
    }

    // Wait before retrying — but don't exceed the remaining budget.
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(interval, remaining));
    interval *= 2; // exponential backoff
  }

  return { results: lastResults, timedOut: true };
}

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Factory — creates a post-verify hook.
 *
 * Priority 95, post-message. Detects service-operation indicators in agent
 * responses and polls health endpoints with exponential backoff. **Never
 * blocks** — if health checks fail, an alert is injected into metadata
 * but the pipeline proceeds.
 */
export function createPostVerifyHook(opts?: PostVerifyOptions): Hook {
  const healthCheckFn = opts?.healthCheckFn ?? DEFAULT_HEALTH_CHECK;
  const pollTimeoutMs = opts?.pollTimeoutMs ?? 30_000;
  const pollIntervalMs = opts?.pollIntervalMs ?? 1_000;

  return {
    name: HOOK_NAME,
    events: ["post-message"],
    priority: 95,

    // ── check() — always passes ────────────────────────────────────
    check(_ctx: HookContext): HookResult {
      return { pass: true };
    },

    // ── postProcess() — detect + poll + inject metadata ────────────
    async postProcess(ctx: HookContext, response: AgentResponse): Promise<void> {
      const content = response.content ?? "";
      const isServiceOp = detectServiceOperation(content);

      if (!isServiceOp) {
        writeLogEvent({
          level: "debug",
          component: COMPONENT,
          action: "postProcess",
          message: "No service-operation indicators detected — skipping health poll",
          data: { sessionId: ctx.sessionId },
        });
        return;
      }

      writeLogEvent({
        level: "info",
        component: COMPONENT,
        action: "postProcess",
        message: "Service operation detected — starting health poll",
        data: { sessionId: ctx.sessionId, pollTimeoutMs, pollIntervalMs },
      });

      let results: HealthCheckResult[];
      let timedOut = false;

      try {
        const poll = await pollHealth(healthCheckFn, pollIntervalMs, pollTimeoutMs);
        results = poll.results;
        timedOut = poll.timedOut;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        writeLogEvent({
          level: "warn",
          component: COMPONENT,
          action: "postProcess",
          message: `Health check threw — injecting alert: ${errorMessage}`,
          data: { sessionId: ctx.sessionId, error: errorMessage },
        });

        // Inject alert metadata — still don't block.
        ctx.hookMetadata = {
          ...ctx.hookMetadata,
          post_verify_error: errorMessage,
          post_verify_healthy: false,
          verified_at: new Date().toISOString(),
        };
        return;
      }

      // Build per-service metadata and determine overall health.
      const allHealthy = results.length === 0 || results.every((r) => r.healthy);
      const serviceStatus: Record<string, boolean> = {};
      for (const r of results) {
        serviceStatus[`${r.name}_healthy`] = r.healthy;
      }

      const meta: Record<string, unknown> = {
        ...serviceStatus,
        post_verify_healthy: allHealthy,
        verified_at: new Date().toISOString(),
      };

      if (timedOut) {
        meta.post_verify_timed_out = true;
      }

      if (!allHealthy) {
        const unhealthy = results.filter((r) => !r.healthy);
        meta.post_verify_alert = `Unhealthy services: ${unhealthy.map((r) => r.name).join(", ")}`;
        for (const r of unhealthy) {
          if (r.detail) {
            meta[`${r.name}_detail`] = r.detail;
          }
        }
      }

      ctx.hookMetadata = { ...ctx.hookMetadata, ...meta };

      writeLogEvent({
        level: allHealthy ? "info" : "warn",
        component: COMPONENT,
        action: "postProcess",
        message: allHealthy
          ? `Health poll complete — all services healthy`
          : `Health poll complete — unhealthy services detected`,
        data: {
          sessionId: ctx.sessionId,
          allHealthy,
          timedOut,
          serviceCount: results.length,
          unhealthyCount: results.filter((r) => !r.healthy).length,
        },
      });
    },
  };
}
