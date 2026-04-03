/**
 * OpenClaw lifecycle hook handlers for the ARC adapter plugin.
 *
 * createArcHookHandlers() builds a real ARC supervision pipeline and
 * returns 3 bound handler functions that drive OpenClaw's lifecycle bus.
 */

import {
  createDefaultPipeline,
  type DefaultPipeline,
  type EnforcementMode,
  type CompletionAudit,
} from "@axiom-labs/arc-core";
import type { Profile } from "@axiom-labs/arc-core";

// ─── OpenClaw context interfaces ─────────────────────────────────────

/** Context passed to beforePromptBuild by the OpenClaw lifecycle bus. */
export interface BeforePromptBuildContext {
  sessionId?: string;
  model?: string;
  message?: string;
  [key: string]: unknown;
}

/** Context passed to agentEnd by the OpenClaw lifecycle bus. */
export interface AgentEndContext {
  sessionId?: string;
  reason?: string;
  responseContent?: string;
  toolCalls?: unknown[];
  message?: string;
  [key: string]: unknown;
}

/** Context passed to sessionEnd by the OpenClaw lifecycle bus. */
export interface SessionEndContext {
  sessionId?: string;
  [key: string]: unknown;
}

// ─── Handler result types ────────────────────────────────────────────

export interface BeforePromptBuildResult {
  prepend: string;
  append: string;
}

export interface AgentEndResult {
  continue: boolean;
  continueReason?: string;
}

// ─── Handler bundle ──────────────────────────────────────────────────

export interface ArcHookHandlers {
  beforePromptBuild: (ctx: BeforePromptBuildContext) => Promise<BeforePromptBuildResult>;
  agentEnd: (ctx: AgentEndContext) => Promise<AgentEndResult>;
  sessionEnd: (ctx: SessionEndContext) => void;
}

// ─── Confidence threshold (matches audit-score.ts) ───────────────────

const CONFIDENCE_THRESHOLD = 0.4;

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Create ARC hook handlers bound to a real supervision pipeline.
 *
 * Builds a DefaultPipeline from the profile's hook configs and returns
 * 3 functions matching OpenClaw's lifecycle hook signatures.
 */
export function createArcHookHandlers(profile: Profile): ArcHookHandlers {
  const { bus, stateStore }: DefaultPipeline = createDefaultPipeline(profile.hooks);
  const enforcement: EnforcementMode = profile.enforcement ?? "log";

  function buildHookContext(
    sessionId: string,
    message: string,
  ) {
    return {
      message,
      sessionId,
      profile,
      adapter: "openclaw" as const,
    };
  }

  // ── beforePromptBuild ────────────────────────────────────────────

  async function beforePromptBuild(
    ctx: BeforePromptBuildContext,
  ): Promise<BeforePromptBuildResult> {
    const sessionId = ctx.sessionId ?? "unknown";
    const message = ctx.message ?? "";

    const hookCtx = buildHookContext(sessionId, message);
    const result = await bus.runPre(hookCtx, enforcement, "pre-message");

    // Format risk/source metadata as a system-prompt prepend
    const lines: string[] = [];

    if (result.metadata.messageSource) {
      lines.push(`[ARC] Source: ${result.metadata.messageSource}`);
    }
    if (result.metadata.riskTier) {
      lines.push(`[ARC] Risk: ${result.metadata.riskTier}`);
    }
    if (result.blocked) {
      lines.push(`[ARC] ⚠ Pipeline blocked — enforce mode active`);
    }

    const prepend = lines.length > 0 ? lines.join("\n") : "";
    return { prepend, append: "" };
  }

  // ── agentEnd ─────────────────────────────────────────────────────

  async function agentEnd(ctx: AgentEndContext): Promise<AgentEndResult> {
    const sessionId = ctx.sessionId ?? "unknown";
    const message = ctx.message ?? "";
    const responseContent = ctx.responseContent ?? "";
    const toolCalls = ctx.toolCalls ?? [];

    const hookCtx = buildHookContext(sessionId, message);
    const agentResponse = {
      content: responseContent,
      toolCalls,
    };

    await bus.runPost(hookCtx, agentResponse, enforcement, "post-message");

    // Read audit result from state store (deposited by audit-score hook)
    const audit = stateStore.get<CompletionAudit>(
      sessionId,
      "audit-score",
      "auditResult",
    );

    // In enforce mode: if audit confidence is below threshold, signal retry
    if (enforcement === "enforce" && audit && audit.confidence < CONFIDENCE_THRESHOLD) {
      const feedback = `Audit incomplete (confidence=${audit.confidence.toFixed(2)}, status=${audit.status}): ${audit.checksFailed.join(", ") || "low confidence"}`;
      return { continue: true, continueReason: feedback };
    }

    return { continue: false };
  }

  // ── sessionEnd ───────────────────────────────────────────────────

  function sessionEnd(ctx: SessionEndContext): void {
    const sessionId = ctx.sessionId ?? "unknown";
    stateStore.clear(sessionId);

    console.log("[arc:openclaw] sessionEnd — state cleared", { sessionId });
  }

  return { beforePromptBuild, agentEnd, sessionEnd };
}
