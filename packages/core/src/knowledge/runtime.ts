/**
 * Runtime composition of the ARC assistant system prompt. Blends static
 * domain knowledge (architecture, concepts, commands) with a live snapshot
 * of user state (active profile, recent launches, doctor issues, version)
 * to produce one structured prompt string under ~4000 tokens.
 */

import type { ArcConfig, Profile } from "../types.js";
import { ARC_KNOWLEDGE } from "./static.js";
import { FEATURES_INDEX } from "./feature-index.js";

export interface LaunchHistoryEntry {
  profile: string;
  tool?: string;
  mode?: "default" | "bare" | "native" | "worker";
  startedAt: string;
  exitCode?: number;
  durationMs?: number;
}

export type PermissionMode = "read-only" | "supervised" | "autonomous";

export interface KnowledgeContext {
  config: ArcConfig;
  recentLaunches: LaunchHistoryEntry[];
  activeProfile: Profile | null;
  arcVersion: string;
  doctorIssues?: string[];
  permissionMode: PermissionMode;
  toolCategories: string[];
}

/** Rough token estimator — 4 chars per token. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

const TOKEN_BUDGET = 4000;
const MAX_RECENT_LAUNCHES = 3;
const MAX_DOCTOR_ISSUES = 8;
const MAX_CONCEPTS = 14;
const MAX_COMMANDS_IN_PROMPT = 32;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + "...";
}

function formatLaunch(l: LaunchHistoryEntry): string {
  const mode = l.mode ? ` [${l.mode}]` : "";
  const tool = l.tool ? ` (${l.tool})` : "";
  const code =
    typeof l.exitCode === "number" ? ` exit=${l.exitCode}` : "";
  const dur =
    typeof l.durationMs === "number" ? ` ${Math.round(l.durationMs / 1000)}s` : "";
  return `  - ${l.startedAt} ${l.profile}${tool}${mode}${code}${dur}`;
}

function section(title: string, body: string): string {
  return `## ${title}\n${body}`.trim();
}

/**
 * Compose the full assistant system prompt from static knowledge + live
 * context. Output is structured in 6 sections. Hard-capped to stay within
 * a ~4000-token budget; long inputs (recentLaunches, doctorIssues) are
 * truncated, and overall output is clamped as a final safety.
 */
export function buildSystemPrompt(ctx: KnowledgeContext): string {
  // 1. Identity
  const identity = section(
    "Identity",
    [
      "You are the ARC assistant — an in-app helper embedded in ARC",
      "(Agent Runtime Control). You understand ARC's profile model,",
      "adapters, hook pipeline, shared layer, and dashboard. You help",
      "the user inspect, configure, launch, and orchestrate agent",
      "runtimes through ARC's commands and tools.",
    ].join(" "),
  );

  // 2. Capabilities
  const caps = ctx.toolCategories.length
    ? ctx.toolCategories.map((c) => `- ${c}`).join("\n")
    : "- (no tools available in this session)";
  const capabilities = section(
    "Capabilities",
    `You have access to tools in the following categories (schemas provided separately):\n${caps}`,
  );

  // 3. Architecture brief
  const arch = truncate(ARC_KNOWLEDGE.architecture, 1400);
  const architecture = section("ARC architecture", arch);

  // 4. Concepts glossary (trimmed)
  const conceptKeys = Object.keys(ARC_KNOWLEDGE.concepts).slice(0, MAX_CONCEPTS);
  const glossary = conceptKeys
    .map((k) => `- **${k}**: ${ARC_KNOWLEDGE.concepts[k]}`)
    .join("\n");
  const concepts = section("Key concepts", glossary);

  // 5. Live state snapshot
  const profileCount = Object.keys(ctx.config.profiles).length;
  const activeName = ctx.config.activeProfile || "(none)";
  const activeTool = ctx.activeProfile?.tool ?? "unknown";
  const activeAuth = ctx.activeProfile?.authType ?? "unknown";
  const sharedOn = ctx.activeProfile?.useShared ? "yes" : "no";
  const enforcement = ctx.activeProfile?.enforcement ?? "log";

  const launches = ctx.recentLaunches
    .slice(0, MAX_RECENT_LAUNCHES)
    .map(formatLaunch)
    .join("\n");

  const issues = (ctx.doctorIssues ?? []).slice(0, MAX_DOCTOR_ISSUES);
  const issuesBlock = issues.length
    ? issues.map((i) => `  - ${truncate(i, 160)}`).join("\n")
    : "  - none";

  const shippedFeatureCount = FEATURES_INDEX.filter(
    (f) => f.status === "shipped",
  ).length;

  const liveState = section(
    "Live state",
    [
      `- ARC version: ${ctx.arcVersion}`,
      `- Permission mode: ${ctx.permissionMode}`,
      `- Active profile: ${activeName} (tool=${activeTool}, auth=${activeAuth}, shared=${sharedOn}, enforcement=${enforcement})`,
      `- Total profiles: ${profileCount}`,
      `- Shipped features indexed: ${shippedFeatureCount}`,
      `- Recent launches (last ${MAX_RECENT_LAUNCHES}):`,
      launches || "  - none",
      `- Doctor issues:`,
      issuesBlock,
    ].join("\n"),
  );

  // 6. Behavior rules
  const modeRules: Record<PermissionMode, string> = {
    "read-only": [
      "You are in read-only mode. You may inspect ARC state but you MUST NOT",
      "call tools that modify profiles, credentials, or run subprocesses.",
      "If the user asks for a destructive action, explain what command",
      "they would run instead and stop.",
    ].join(" "),
    supervised: [
      "You are in supervised mode. For destructive actions (profile delete,",
      "credential swap, backup restore, shared push/pull, factory abort) you",
      "MUST state your plan and wait for user confirmation before invoking",
      "the tool. Non-destructive reads may proceed without confirmation.",
    ].join(" "),
    autonomous: [
      "You are in autonomous mode. You may invoke tools without per-action",
      "confirmation, but still narrate what you are doing, and stop",
      "immediately if a tool returns an error or unexpected state.",
    ].join(" "),
  };

  const behavior = section(
    "Behavior rules",
    [
      "- Prefer tools over speculation. If the user asks about their state,",
      "  read it through the provided tools rather than guessing.",
      "- Prefer asking one clarifying question over guessing when intent is",
      "  ambiguous about which profile or tool is involved.",
      "- Cite the exact `arc ...` command when recommending an action, so",
      "  the user can run it outside the assistant if they prefer.",
      "- Treat `swap`, `backup restore`, `profile delete`, `shared push`,",
      "  `factory abort`, and `uninstall` as destructive.",
      "- Never invent commands, flags, or concepts. If unsure, say so.",
      "",
      modeRules[ctx.permissionMode],
    ].join("\n"),
  );

  // Compose + enforce token cap
  let prompt = [
    identity,
    capabilities,
    architecture,
    concepts,
    liveState,
    behavior,
  ].join("\n\n");

  // Final safety clamp. Aim for 2500-3000; hard cap at 4000.
  if (estimateTokens(prompt) > TOKEN_BUDGET) {
    const maxChars = TOKEN_BUDGET * 4;
    prompt = truncate(prompt, maxChars);
  }

  return prompt;
}
