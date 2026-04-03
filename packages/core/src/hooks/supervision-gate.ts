import { writeLogEvent } from "../logging.js";
import type {
  Hook,
  HookContext,
  HookResult,
  AgentResponse,
  EnforcementMode,
} from "./types.js";
import type { HookStateStore } from "./hook-state.js";

// ─── Public interfaces ───────────────────────────────────────────────

/** Context passed to the supervisor function for review. */
export interface GateReviewContext {
  /** The user/system message that triggered the agent turn. */
  message: string;
  /** Session identifier. */
  sessionId: string;
  /** Raw response content from the agent. */
  responseContent: string;
  /** Summary of tool calls made in this turn (stringified names). */
  toolCallsSummary: string[];
}

/** Options for createSupervisionGateHook factory. */
export interface SupervisionGateOptions {
  /** State store for persisting gate decisions across check/postProcess. */
  stateStore: HookStateStore;
  /**
   * Pluggable supervisor function. Receives review context, returns an
   * "ALLOW: reason" or "BLOCK: reason" first-line response.
   * Default: pass-through that always returns ALLOW.
   */
  supervisorFn?: (ctx: GateReviewContext) => Promise<string>;
  /**
   * When true (default), only invoke the supervisor for substantive turns
   * (tool calls or file-change indicators). Non-substantive turns auto-ALLOW.
   */
  onlySubstantive?: boolean;
}

// ─── Internal types ──────────────────────────────────────────────────

type GateDecision = "ALLOW" | "BLOCK";

interface StoredGateResult {
  decision: GateDecision;
  reason: string;
  substantive: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────

const HOOK_NAME = "supervision-gate";
const GATE_KEY = "gateDecision";
const COMPONENT = `hook:${HOOK_NAME}`;

/** Word-boundary patterns indicating file-change operations. */
const FILE_CHANGE_PATTERNS = [
  /\bcreated\s+file\b/i,
  /\bmodified\b/i,
  /\bwrote\s+to\b/i,
  /\bdeleted\b/i,
];

/** Default supervisor — always allows. */
const DEFAULT_SUPERVISOR: (ctx: GateReviewContext) => Promise<string> = async () =>
  "ALLOW: no supervisor configured";

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Detect whether an agent response is "substantive" — i.e. it contains
 * tool calls or text indicators of file-system changes.
 */
export function isSubstantive(response: AgentResponse): boolean {
  if (response.toolCalls && response.toolCalls.length > 0) {
    return true;
  }
  const content = response.content ?? "";
  return FILE_CHANGE_PATTERNS.some((re) => re.test(content));
}

/**
 * Parse the first line of a supervisor response into a decision + reason.
 * Unknown formats are treated as ALLOW with a warning.
 */
export function parseGateResponse(raw: string): {
  decision: GateDecision;
  reason: string;
  unknown: boolean;
} {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { decision: "ALLOW", reason: "empty supervisor response", unknown: true };
  }

  const firstLine = trimmed.split(/\r?\n/)[0].trim();
  const upper = firstLine.toUpperCase();

  if (upper.startsWith("ALLOW")) {
    const reason = firstLine.slice("ALLOW".length).replace(/^:\s*/, "").trim();
    return { decision: "ALLOW", reason: reason || "no reason provided", unknown: false };
  }

  if (upper.startsWith("BLOCK")) {
    const reason = firstLine.slice("BLOCK".length).replace(/^:\s*/, "").trim();
    return { decision: "BLOCK", reason: reason || "no reason provided", unknown: false };
  }

  return { decision: "ALLOW", reason: `unknown format: ${firstLine}`, unknown: true };
}

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Factory — creates a supervision-gate hook bound to a HookStateStore.
 *
 * Priority 92, post-message: detects substantive agent output, invokes a
 * pluggable supervisor function, parses the ALLOW/BLOCK response, and
 * persists the decision. check() reads the stored decision and blocks
 * only in enforce mode.
 */
export function createSupervisionGateHook(opts: SupervisionGateOptions): Hook {
  const { stateStore, onlySubstantive = true } = opts;
  const supervisorFn = opts.supervisorFn ?? DEFAULT_SUPERVISOR;

  return {
    name: HOOK_NAME,
    events: ["post-message"],
    priority: 92,

    check(ctx: HookContext): HookResult {
      const enforcement: EnforcementMode = ctx.profile.enforcement ?? "log";
      const stored = stateStore.get<StoredGateResult>(
        ctx.sessionId,
        HOOK_NAME,
        GATE_KEY,
      );

      // No prior decision — nothing to judge
      if (!stored) {
        return { pass: true };
      }

      if (stored.decision === "BLOCK") {
        const shouldBlock = enforcement === "enforce";

        writeLogEvent({
          level: shouldBlock ? "warn" : "info",
          component: COMPONENT,
          action: "check",
          message: `Gate BLOCK: ${stored.reason} (enforcement=${enforcement}, blocking=${shouldBlock})`,
          data: {
            decision: stored.decision,
            reason: stored.reason,
            enforcement,
            shouldBlock,
            sessionId: ctx.sessionId,
          },
        });

        if (shouldBlock) {
          return {
            pass: false,
            block: true,
            reason: `Blocked by supervisor: ${stored.reason}`,
          };
        }

        // log/advise — flag but don't block
        return {
          pass: true,
          flag: `Supervisor would block: ${stored.reason}`,
        };
      }

      // ALLOW
      return {
        pass: true,
        metadata: { gateDecision: stored.decision, gateReason: stored.reason },
      };
    },

    async postProcess(ctx: HookContext, response: AgentResponse): Promise<void> {
      const substantive = isSubstantive(response);

      // Skip non-substantive turns if configured
      if (onlySubstantive && !substantive) {
        const result: StoredGateResult = {
          decision: "ALLOW",
          reason: "non-substantive turn — skipped review",
          substantive: false,
        };
        stateStore.set(ctx.sessionId, HOOK_NAME, GATE_KEY, result);

        writeLogEvent({
          level: "debug",
          component: COMPONENT,
          action: "postProcess",
          message: "Skipped supervision — non-substantive turn",
          data: { sessionId: ctx.sessionId, substantive: false },
        });
        return;
      }

      // Build review context
      const reviewCtx: GateReviewContext = {
        message: ctx.message,
        sessionId: ctx.sessionId,
        responseContent: response.content ?? "",
        toolCallsSummary: (response.toolCalls ?? []).map((tc) => {
          if (tc && typeof tc === "object" && "name" in tc) {
            return String((tc as { name: unknown }).name);
          }
          return "unknown";
        }),
      };

      let rawResponse: string;
      try {
        rawResponse = await supervisorFn(reviewCtx);
      } catch (err) {
        // Graceful degradation — supervisor failure → ALLOW
        const errorMessage = err instanceof Error ? err.message : String(err);
        const result: StoredGateResult = {
          decision: "ALLOW",
          reason: `supervisor error: ${errorMessage}`,
          substantive,
        };
        stateStore.set(ctx.sessionId, HOOK_NAME, GATE_KEY, result);

        writeLogEvent({
          level: "warn",
          component: COMPONENT,
          action: "postProcess",
          message: `Supervisor function threw — defaulting to ALLOW: ${errorMessage}`,
          data: { sessionId: ctx.sessionId, error: errorMessage },
        });
        return;
      }

      const { decision, reason, unknown: unknownFormat } = parseGateResponse(rawResponse);

      if (unknownFormat) {
        writeLogEvent({
          level: "warn",
          component: COMPONENT,
          action: "postProcess",
          message: `Unknown supervisor response format — treating as ALLOW: ${reason}`,
          data: { sessionId: ctx.sessionId, rawFirstLine: rawResponse?.trim().split(/\r?\n/)[0] },
        });
      }

      const result: StoredGateResult = { decision, reason, substantive };
      stateStore.set(ctx.sessionId, HOOK_NAME, GATE_KEY, result);

      writeLogEvent({
        level: decision === "BLOCK" ? "warn" : "info",
        component: COMPONENT,
        action: "postProcess",
        message: `Gate decision: ${decision} — ${reason}`,
        data: {
          decision,
          reason,
          substantive,
          unknownFormat,
          sessionId: ctx.sessionId,
        },
      });
    },
  };
}
