import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { classifyRisk, writeLogEvent } from "@axiom-labs/arc-core";
import type { RiskTier } from "@axiom-labs/arc-core";

// ─── Sub-action detection patterns ──────────────────────────────────

interface SubAction {
  category: "file-ops" | "network" | "process" | "package-mgmt" | "git" | "build";
  action: string;
  evidence: string;
}

const SUB_ACTION_PATTERNS: {
  category: SubAction["category"];
  patterns: { regex: RegExp; action: string }[];
}[] = [
  {
    category: "file-ops",
    patterns: [
      { regex: /\b(create|write|touch)\s+(a\s+)?(file|directory|folder)/i, action: "create filesystem entry" },
      { regex: /\b(delete|remove|rm)\s+(a\s+)?(file|directory|folder)/i, action: "delete filesystem entry" },
      { regex: /\b(move|rename|mv)\s+(a\s+)?(file|directory|folder)/i, action: "move/rename filesystem entry" },
      { regex: /\b(read|cat|open)\s+(a\s+)?(file)/i, action: "read file contents" },
      { regex: /\b(edit|modify|update|change)\s+(a\s+)?(file|config|configuration)/i, action: "modify file" },
      { regex: /\bchmod\b/i, action: "change file permissions" },
      { regex: /\bchown\b/i, action: "change file ownership" },
    ],
  },
  {
    category: "network",
    patterns: [
      { regex: /\b(fetch|request|call|hit)\s+(an?\s+)?(api|endpoint|url|service)/i, action: "make HTTP request" },
      { regex: /\bcurl\b/i, action: "make HTTP request via curl" },
      { regex: /\bwget\b/i, action: "download file via wget" },
      { regex: /\b(download|upload)\b/i, action: "network file transfer" },
      { regex: /\b(ssh|scp|rsync)\b/i, action: "remote shell/transfer" },
    ],
  },
  {
    category: "process",
    patterns: [
      { regex: /\b(run|execute|start|launch|spawn)\s+(a\s+)?(command|process|script|server|service)/i, action: "execute process" },
      { regex: /\b(kill|stop|terminate)\s+(a\s+)?(process|server|service)/i, action: "terminate process" },
      { regex: /\b(restart|reload)\s+(a\s+)?(process|server|service)/i, action: "restart process" },
    ],
  },
  {
    category: "package-mgmt",
    patterns: [
      { regex: /\b(npm|yarn|pnpm)\s+(install|add|remove|uninstall)/i, action: "manage npm packages" },
      { regex: /\bpip\s+(install|uninstall)/i, action: "manage Python packages" },
      { regex: /\bapt(-get)?\s+(install|remove)/i, action: "manage system packages" },
      { regex: /\bbrew\s+(install|uninstall)/i, action: "manage Homebrew packages" },
    ],
  },
  {
    category: "git",
    patterns: [
      { regex: /\bgit\s+(commit|push|pull|merge|rebase|checkout|branch|stash|reset)/i, action: "git operation" },
      { regex: /\b(commit|push|pull|merge)\s+(to|from|the)?\s*(changes|code|branch)/i, action: "git operation" },
    ],
  },
  {
    category: "build",
    patterns: [
      { regex: /\b(build|compile|transpile|bundle)\b/i, action: "build/compile" },
      { regex: /\b(test|lint|typecheck)\b/i, action: "run quality checks" },
      { regex: /\b(deploy|release|publish)\b/i, action: "deploy/release" },
    ],
  },
];

/** Detect implied sub-actions from an action string. */
function detectSubActions(action: string): SubAction[] {
  const found: SubAction[] = [];

  for (const group of SUB_ACTION_PATTERNS) {
    for (const { regex, action: subAction } of group.patterns) {
      const match = regex.exec(action);
      if (match) {
        found.push({
          category: group.category,
          action: subAction,
          evidence: match[0],
        });
      }
    }
  }

  return found;
}

/** Infer implicit operations that follow from the risk tier. */
function inferImplicitOps(tier: RiskTier, subActions: SubAction[]): string[] {
  const implicit: string[] = [];
  const categories = new Set(subActions.map((s) => s.category));

  if (tier === "deploy-affecting" || tier === "destructive") {
    if (!categories.has("git")) implicit.push("Likely involves git operations");
    if (!categories.has("build")) implicit.push("May trigger build/CI pipeline");
  }

  if (categories.has("package-mgmt")) {
    implicit.push("Will modify lockfile");
    implicit.push("May alter dependency tree for other packages");
  }

  if (categories.has("process")) {
    implicit.push("May bind network ports");
    implicit.push("May consume system resources (CPU/memory)");
  }

  return implicit;
}

/**
 * Register the arc_expand_intent tool on an MCP server.
 *
 * Deterministic intent expansion: classifies risk, extracts implied sub-actions
 * (file ops, network, process, etc.), and returns a structured breakdown of
 * what the action implies. Pure function, no LLM.
 */
export function registerExpandIntent(server: McpServer): void {
  server.tool(
    "arc_expand_intent",
    "Expand an agent action into its implied sub-actions and risk assessment. Returns risk classification, detected sub-actions (file ops, network, process, etc.), and implicit operations.",
    { action: z.string().describe("The action string to expand") },
    async ({ action }) => {
      writeLogEvent({
        level: "info",
        component: "mcp:tool:expand_intent",
        message: `Expanding intent for action (${action.length} chars)`,
        data: { actionPreview: action.slice(0, 120) },
      });

      const risk = classifyRisk(action);
      const subActions = detectSubActions(action);
      const implicitOps = inferImplicitOps(risk.tier, subActions);

      const result = {
        action: action.length > 500 ? action.slice(0, 500) + "…" : action,
        risk: {
          tier: risk.tier,
          requiresConfirmation: risk.requiresConfirmation,
          checklistIntensity: risk.checklistIntensity,
        },
        subActions,
        implicitOperations: implicitOps,
        summary: buildSummary(risk.tier, subActions, implicitOps),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}

function buildSummary(tier: RiskTier, subActions: SubAction[], implicitOps: string[]): string {
  const parts: string[] = [];
  parts.push(`Risk tier: ${tier}.`);

  if (subActions.length > 0) {
    const categories = [...new Set(subActions.map((s) => s.category))];
    parts.push(`Detected ${subActions.length} sub-action(s) across: ${categories.join(", ")}.`);
  } else {
    parts.push("No explicit sub-actions detected.");
  }

  if (implicitOps.length > 0) {
    parts.push(`${implicitOps.length} implicit operation(s) inferred.`);
  }

  return parts.join(" ");
}
