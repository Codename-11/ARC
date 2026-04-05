import { writeLogEvent } from "../logging.js";
import type { Hook, HookContext, HookResult, HookMetadata, MessageSource } from "./types.js";

/**
 * Determines the MessageSource from session context.
 * Priority 1 — runs first so downstream hooks (like risk-detection) can branch on source.
 *
 * Classification heuristics (checked in order):
 * 1. sessionId contains "cron" or "scheduled" → cron
 * 2. sessionId contains "agent" or "auto" → agent
 * 3. adapter name is "system" or sessionId starts with "system-" → system
 * 4. adapter is a known interactive tool (claude, codex, gemini, openclaw, hermes, generic) → user
 * 5. Otherwise → unknown
 */
export const sourceClassifyHook: Hook = {
  name: "source-classify",
  events: ["pre-message", "pre-launch"],
  priority: 1,

  check(ctx: HookContext): HookResult {
    const source = classifySource(ctx);

    writeLogEvent({
      level: "info",
      component: "hook:source-classify",
      action: "classify",
      message: `Classified message source as '${source}'`,
      data: {
        source,
        sessionId: ctx.sessionId,
        adapter: ctx.adapter,
      },
    });

    return {
      pass: true,
      metadata: { messageSource: source },
    };
  },

  inject(ctx: HookContext): HookMetadata | undefined {
    const source = classifySource(ctx);
    // Enrich the mutable context so downstream hooks can read ctx.source
    ctx.source = source;
    return { messageSource: source };
  },
};

/**
 * Pure classification function — determines MessageSource from HookContext fields.
 */
function classifySource(ctx: HookContext): MessageSource {
  const sid = ctx.sessionId.toLowerCase();
  const adapter = ctx.adapter.toLowerCase();

  // Cron / scheduled jobs
  if (sid.includes("cron") || sid.includes("scheduled")) {
    return "cron";
  }

  // Agent / automated sessions
  if (sid.includes("agent") || sid.includes("auto")) {
    return "agent";
  }

  // System-originated messages
  if (adapter === "system" || sid.startsWith("system-")) {
    return "system";
  }

  // Known interactive adapters → user
  const interactiveAdapters = ["claude", "codex", "gemini", "openclaw", "hermes", "generic"];
  if (interactiveAdapters.includes(adapter)) {
    return "user";
  }

  return "unknown";
}
