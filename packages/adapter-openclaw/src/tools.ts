/**
 * ARC agent tool definitions for the OpenClaw plugin.
 *
 * Each tool follows the MCP-compatible shape that OpenClaw's tool registry
 * expects: { name, description, parameters, execute }. The execute function
 * returns { content: [{ type: "text", text: JSON.stringify(result) }] }.
 *
 * These are stub implementations — they return structured placeholder
 * responses. Real supervision logic is wired in M003/M004.
 */

import type { OpenClawToolDefinition, ToolResult } from "./types.js";

/** Helper: wrap a result object in the MCP-compatible content envelope. */
function wrapResult(result: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
}

export const arcExpandIntent: OpenClawToolDefinition = {
  name: "arc_expand_intent",
  description:
    "Expand a user intent into a structured plan with goals, constraints, and suggested steps.",
  parameters: {
    type: "object",
    properties: {
      intent: { type: "string", description: "The user intent to expand." },
    },
    required: ["intent"],
  },
  async execute(_id: string, params: Record<string, unknown>): Promise<ToolResult> {
    const intent = String(params.intent ?? "");
    console.log("[arc:openclaw] arc_expand_intent called", { intent });
    return wrapResult({
      intent,
      expanded: true,
      goals: [],
      constraints: [],
      steps: [],
      stub: true,
    });
  },
};

export const arcClassifyRisk: OpenClawToolDefinition = {
  name: "arc_classify_risk",
  description:
    "Classify the risk tier of a proposed agent action based on ARC policy rules.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", description: "The action to classify." },
    },
    required: ["action"],
  },
  async execute(_id: string, params: Record<string, unknown>): Promise<ToolResult> {
    const action = String(params.action ?? "");
    console.log("[arc:openclaw] arc_classify_risk called", { action });
    return wrapResult({
      action,
      tier: "low",
      reason: "stub",
    });
  },
};

export const arcDeriveCompletion: OpenClawToolDefinition = {
  name: "arc_derive_completion",
  description:
    "Derive completion criteria for a task based on ARC supervision context.",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "The task to derive completion for." },
    },
    required: ["task"],
  },
  async execute(_id: string, params: Record<string, unknown>): Promise<ToolResult> {
    const task = String(params.task ?? "");
    console.log("[arc:openclaw] arc_derive_completion called", { task });
    return wrapResult({
      task,
      criteria: [],
      derived: true,
      stub: true,
    });
  },
};

export const arcAuditCompletion: OpenClawToolDefinition = {
  name: "arc_audit_completion",
  description:
    "Audit whether a task result satisfies the completion criteria.",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "The task that was completed." },
      result: { type: "string", description: "The result to audit." },
    },
    required: ["task", "result"],
  },
  async execute(_id: string, params: Record<string, unknown>): Promise<ToolResult> {
    const task = String(params.task ?? "");
    const result = String(params.result ?? "");
    console.log("[arc:openclaw] arc_audit_completion called", { task, result });
    return wrapResult({
      task,
      result,
      passed: true,
      findings: [],
      stub: true,
    });
  },
};

export const arcExplainTrace: OpenClawToolDefinition = {
  name: "arc_explain_trace",
  description:
    "Explain an ARC supervision trace entry in human-readable form.",
  parameters: {
    type: "object",
    properties: {
      traceId: { type: "string", description: "The trace ID to explain." },
    },
    required: ["traceId"],
  },
  async execute(_id: string, params: Record<string, unknown>): Promise<ToolResult> {
    const traceId = String(params.traceId ?? "");
    console.log("[arc:openclaw] arc_explain_trace called", { traceId });
    return wrapResult({
      traceId,
      explanation: "Stub trace explanation — real implementation in M003/M004.",
      events: [],
      stub: true,
    });
  },
};

/** All ARC agent tool definitions, for convenient iteration. */
export const allTools: OpenClawToolDefinition[] = [
  arcExpandIntent,
  arcClassifyRisk,
  arcDeriveCompletion,
  arcAuditCompletion,
  arcExplainTrace,
];
