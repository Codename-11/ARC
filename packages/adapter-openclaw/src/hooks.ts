/**
 * OpenClaw lifecycle hook handlers for the ARC adapter plugin.
 *
 * These are stub implementations — they log invocations and return
 * structured no-op responses. Real supervision logic (profile loading,
 * policy enforcement, trace capture) is wired in M003/M004.
 */

/** Context passed to beforePromptBuild by the OpenClaw lifecycle bus. */
export interface BeforePromptBuildContext {
  sessionId?: string;
  model?: string;
  [key: string]: unknown;
}

/** Context passed to agentEnd by the OpenClaw lifecycle bus. */
export interface AgentEndContext {
  sessionId?: string;
  reason?: string;
  [key: string]: unknown;
}

/** Context passed to sessionEnd by the OpenClaw lifecycle bus. */
export interface SessionEndContext {
  sessionId?: string;
  [key: string]: unknown;
}

/**
 * Called before each prompt is built. Can prepend/append text to the prompt.
 * Stub: returns empty strings (no modification).
 */
export function beforePromptBuild(
  context: BeforePromptBuildContext,
): { prepend: string; append: string } {
  console.log("[arc:openclaw] beforePromptBuild invoked", {
    sessionId: context.sessionId ?? "unknown",
  });
  return { prepend: "", append: "" };
}

/**
 * Called when an agent run ends. Can signal whether to continue.
 * Stub: returns continue: false (do not restart agent).
 */
export function agentEnd(
  context: AgentEndContext,
): { continue: boolean } {
  console.log("[arc:openclaw] agentEnd invoked", {
    sessionId: context.sessionId ?? "unknown",
    reason: context.reason ?? "none",
  });
  return { continue: false };
}

/**
 * Called when the OpenClaw session ends. Used for cleanup.
 * Stub: logs and returns void.
 */
export function sessionEnd(context: SessionEndContext): void {
  console.log("[arc:openclaw] sessionEnd invoked", {
    sessionId: context.sessionId ?? "unknown",
  });
}
