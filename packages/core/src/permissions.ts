import type { PermissionTier } from "./adapters/types.js";
import { writeLogEvent } from "./logging.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface PermissionPolicy {
  tier: PermissionTier;
  allowPrefixes: string[];
  denyPrefixes: string[];
  requireApproval: string[];
  auditLog: boolean;
}

export type PermissionDecision = "allow" | "deny" | "ask";

// ─── Default policies ───────────────────────────────────────────────

/**
 * Coordinator: full access to all tools, no restrictions.
 * Intended for top-level orchestrating agents.
 */
export const COORDINATOR_DEFAULTS: PermissionPolicy = {
  tier: "coordinator",
  allowPrefixes: ["*"],
  denyPrefixes: [],
  requireApproval: [],
  auditLog: true,
};

/**
 * Interactive: standard access with approval gates for destructive ops.
 * Intended for human-facing agents that can prompt for confirmation.
 */
export const INTERACTIVE_DEFAULTS: PermissionPolicy = {
  tier: "interactive",
  allowPrefixes: [
    "read",
    "glob",
    "grep",
    "write",
    "edit",
    "bash",
    "powershell",
    "notebook",
    "web",
    "mcp",
  ],
  denyPrefixes: [],
  requireApproval: [
    "delete",
    "deploy",
    "spawn",
    "push",
    "force",
    "reset",
    "destroy",
  ],
  auditLog: true,
};

/**
 * Worker: degraded access, no destructive operations allowed.
 * Intended for background/automated sub-agents.
 */
export const WORKER_DEFAULTS: PermissionPolicy = {
  tier: "worker",
  allowPrefixes: [
    "read",
    "glob",
    "grep",
    "write",
    "edit",
    "bash",
    "powershell",
    "notebook",
  ],
  denyPrefixes: [
    "delete",
    "spawn",
    "deploy",
    "push",
    "force",
    "reset",
    "destroy",
  ],
  requireApproval: [],
  auditLog: true,
};

// ─── Tier → defaults lookup ─────────────────────────────────────────

const TIER_DEFAULTS: Record<PermissionTier, PermissionPolicy> = {
  coordinator: COORDINATOR_DEFAULTS,
  interactive: INTERACTIVE_DEFAULTS,
  worker: WORKER_DEFAULTS,
};

// ─── Factory ────────────────────────────────────────────────────────

/**
 * Create a permission policy for the given tier, optionally merging
 * caller-supplied overrides on top of the tier defaults.
 */
export function createPermissionPolicy(
  tier: PermissionTier,
  overrides?: Partial<PermissionPolicy>,
): PermissionPolicy {
  const base = TIER_DEFAULTS[tier];
  return {
    ...base,
    ...overrides,
    tier: overrides?.tier ?? base.tier,
  };
}

// ─── Evaluation ─────────────────────────────────────────────────────

function matchesAny(toolName: string, prefixes: string[]): boolean {
  const lower = toolName.toLowerCase();
  return prefixes.some((p) => {
    if (p === "*") return true;
    return lower.startsWith(p.toLowerCase());
  });
}

/**
 * Evaluate whether `toolName` is allowed, denied, or needs approval
 * under the given policy.
 *
 * Evaluation order:
 *  1. Explicit deny prefixes  → 'deny'
 *  2. Require-approval list   → 'ask'
 *  3. Allow prefixes (or '*') → 'allow'
 *  4. Otherwise               → 'deny'
 */
export function evaluatePermission(
  policy: PermissionPolicy,
  toolName: string,
): PermissionDecision {
  // 1. Deny takes precedence.
  if (policy.denyPrefixes.length > 0 && matchesAny(toolName, policy.denyPrefixes)) {
    if (policy.auditLog) {
      writeLogEvent({
        level: "warn",
        component: "permissions",
        action: "deny",
        message: `Denied tool "${toolName}" under tier "${policy.tier}"`,
        data: { toolName, tier: policy.tier },
      });
    }
    return "deny";
  }

  // 2. Approval gate.
  if (policy.requireApproval.length > 0 && matchesAny(toolName, policy.requireApproval)) {
    if (policy.auditLog) {
      writeLogEvent({
        level: "info",
        component: "permissions",
        action: "ask",
        message: `Approval required for tool "${toolName}" under tier "${policy.tier}"`,
        data: { toolName, tier: policy.tier },
      });
    }
    return "ask";
  }

  // 3. Explicit allow.
  if (policy.allowPrefixes.length > 0 && matchesAny(toolName, policy.allowPrefixes)) {
    return "allow";
  }

  // 4. Default deny (no matching allow prefix).
  return "deny";
}
