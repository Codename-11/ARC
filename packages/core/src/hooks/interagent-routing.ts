import { writeLogEvent } from "../logging.js";
import type { Hook, HookContext, HookResult, EnforcementMode } from "./types.js";

/**
 * Matches an @mention pattern: @ followed by one or more word characters.
 * Used to detect explicit agent-to-agent addressing that overrides suppression.
 */
const AT_MENTION_RE = /@\w+/;

/**
 * Interagent-routing hook — suppresses bot→bot message loops.
 *
 * Priority 2, pre-message: when the message source is 'agent' and the message
 * does not contain an @mention, the hook signals suppression. In enforce mode
 * this blocks the message; in log/advise modes it flags without blocking.
 *
 * User and other non-agent sources always pass through.
 */
export const interagentRoutingHook: Hook = {
  name: "interagent-routing",
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
        component: "hook:interagent-routing",
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
        component: "hook:interagent-routing",
        action: "check",
        message: `Agent source with @mention — allowing`,
        data: { source: ctx.source, hasMention: true, enforcement },
      });

      return {
        pass: true,
        metadata: { should_suppress: false, hasMention: true },
      };
    }

    // Agent source without @mention — suppress
    const shouldBlock = enforcement === "enforce";

    writeLogEvent({
      level: shouldBlock ? "warn" : "info",
      component: "hook:interagent-routing",
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
