import { writeLogEvent } from "../logging.js";
import type { Hook, HookContext, HookResult, EnforcementMode } from "./types.js";
import type { HookStateStore } from "./hook-state.js";

/**
 * Matches an @mention pattern: @ followed by one or more word characters.
 * Used to detect explicit agent-to-agent addressing that overrides suppression.
 */
const AT_MENTION_RE = /@\w+/;

const HOOK_NAME = "interagent-routing";
const ROUNDTABLE_STATE_KEY = "roundtableState";
const COMPONENT = `hook:${HOOK_NAME}`;

/**
 * Factory — creates an interagent-routing hook bound to a HookStateStore.
 *
 * Priority 2, pre-message: when the message source is 'agent' and the message
 * does not contain an @mention, the hook signals suppression. In enforce mode
 * this blocks the message; in log/advise modes it flags without blocking.
 *
 * User and other non-agent sources always pass through.
 *
 * When a roundtable discussion is active (state stored by the roundtable hook),
 * agent messages are allowed through without requiring @mentions.
 */
export function createInteragentRoutingHook(stateStore: HookStateStore): Hook {
  return {
    name: HOOK_NAME,
    events: ["pre-message"],
    priority: 2,

    check(ctx: HookContext): HookResult {
      const enforcement: EnforcementMode = ctx.profile.enforcement ?? "log";
      const isAgent = ctx.source === "agent";
      const hasMention = AT_MENTION_RE.test(ctx.message);

      // Non-agent sources always pass
      if (!isAgent) {
        writeLogEvent({
          level: "debug",
          component: COMPONENT,
          action: "check",
          message: `Non-agent source '${ctx.source ?? "unknown"}' — allowing`,
          data: { source: ctx.source, enforcement },
        });

        return { pass: true };
      }

      // Agent source with @mention override
      if (hasMention) {
        writeLogEvent({
          level: "info",
          component: COMPONENT,
          action: "check",
          message: `Agent source with @mention — allowing`,
          data: { source: ctx.source, hasMention: true, enforcement },
        });

        return {
          pass: true,
          metadata: { should_suppress: false, hasMention: true },
        };
      }

      // Check for active roundtable — agent messages are allowed during discussions
      const roundtableState = stateStore.get<{ status: string }>(
        ctx.sessionId,
        "roundtable",
        ROUNDTABLE_STATE_KEY,
      );

      if (roundtableState && roundtableState.status === "active") {
        writeLogEvent({
          level: "info",
          component: COMPONENT,
          action: "check",
          message: `Agent source during active roundtable — allowing`,
          data: { source: ctx.source, enforcement, roundtableBypass: true },
        });

        return {
          pass: true,
          metadata: { should_suppress: false, roundtableBypass: true },
        };
      }

      // Agent source without @mention and no roundtable — suppress
      const shouldBlock = enforcement === "enforce";

      writeLogEvent({
        level: shouldBlock ? "warn" : "info",
        component: COMPONENT,
        action: "suppress",
        message: `Agent message without @mention — ${shouldBlock ? "blocked" : "flagged"}`,
        data: {
          source: ctx.source,
          hasMention: false,
          enforcement,
          blocked: shouldBlock,
        },
      });

      return {
        pass: false,
        block: shouldBlock,
        reason: shouldBlock
          ? "Blocked: agent→agent message without @mention (enforce mode)"
          : undefined,
        flag: !shouldBlock
          ? "Agent→agent message without @mention would be suppressed in enforce mode"
          : undefined,
        metadata: { should_suppress: true },
      };
    },
  };
}

/**
 * Backward-compatible plain hook for consumers that don't have a HookStateStore.
 * Does NOT check for roundtable state — use createInteragentRoutingHook() for
 * full functionality in the default pipeline.
 *
 * @deprecated Use createInteragentRoutingHook(stateStore) instead.
 */
export const interagentRoutingHook: Hook = {
  name: HOOK_NAME,
  events: ["pre-message"],
  priority: 2,

  check(ctx: HookContext): HookResult {
    const enforcement: EnforcementMode = ctx.profile.enforcement ?? "log";
    const isAgent = ctx.source === "agent";
    const hasMention = AT_MENTION_RE.test(ctx.message);

    if (!isAgent) {
      return { pass: true };
    }

    if (hasMention) {
      return {
        pass: true,
        metadata: { should_suppress: false, hasMention: true },
      };
    }

    const shouldBlock = enforcement === "enforce";

    return {
      pass: false,
      block: shouldBlock,
      reason: shouldBlock
        ? "Blocked: agent→agent message without @mention (enforce mode)"
        : undefined,
      flag: !shouldBlock
        ? "Agent→agent message without @mention would be suppressed in enforce mode"
        : undefined,
      metadata: { should_suppress: true },
    };
  },
};
