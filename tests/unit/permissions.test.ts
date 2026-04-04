import { describe, it, expect, vi } from "vitest";
import {
  COORDINATOR_DEFAULTS,
  INTERACTIVE_DEFAULTS,
  WORKER_DEFAULTS,
  evaluatePermission,
  createPermissionPolicy,
} from "../../packages/core/src/permissions.js";
import type { PermissionPolicy } from "../../packages/core/src/permissions.js";

// Suppress log I/O during tests
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

// ─── Default policies ───────────────────────────────────────────────

describe("COORDINATOR_DEFAULTS", () => {
  it("allows everything via wildcard", () => {
    expect(COORDINATOR_DEFAULTS.allowPrefixes).toEqual(["*"]);
  });

  it("has no deny prefixes", () => {
    expect(COORDINATOR_DEFAULTS.denyPrefixes).toHaveLength(0);
  });

  it("requires no approvals", () => {
    expect(COORDINATOR_DEFAULTS.requireApproval).toHaveLength(0);
  });

  it("has tier 'coordinator'", () => {
    expect(COORDINATOR_DEFAULTS.tier).toBe("coordinator");
  });

  it("has audit logging enabled", () => {
    expect(COORDINATOR_DEFAULTS.auditLog).toBe(true);
  });
});

describe("INTERACTIVE_DEFAULTS", () => {
  it("allows common tool prefixes", () => {
    expect(INTERACTIVE_DEFAULTS.allowPrefixes).toContain("read");
    expect(INTERACTIVE_DEFAULTS.allowPrefixes).toContain("bash");
    expect(INTERACTIVE_DEFAULTS.allowPrefixes).toContain("edit");
  });

  it("requires approval for destructive operations", () => {
    expect(INTERACTIVE_DEFAULTS.requireApproval).toContain("delete");
    expect(INTERACTIVE_DEFAULTS.requireApproval).toContain("deploy");
    expect(INTERACTIVE_DEFAULTS.requireApproval).toContain("force");
    expect(INTERACTIVE_DEFAULTS.requireApproval).toContain("destroy");
  });

  it("has no deny prefixes", () => {
    expect(INTERACTIVE_DEFAULTS.denyPrefixes).toHaveLength(0);
  });

  it("has tier 'interactive'", () => {
    expect(INTERACTIVE_DEFAULTS.tier).toBe("interactive");
  });
});

describe("WORKER_DEFAULTS", () => {
  it("denies destructive operations", () => {
    expect(WORKER_DEFAULTS.denyPrefixes).toContain("delete");
    expect(WORKER_DEFAULTS.denyPrefixes).toContain("deploy");
    expect(WORKER_DEFAULTS.denyPrefixes).toContain("force");
    expect(WORKER_DEFAULTS.denyPrefixes).toContain("destroy");
  });

  it("allows common read/write tool prefixes", () => {
    expect(WORKER_DEFAULTS.allowPrefixes).toContain("read");
    expect(WORKER_DEFAULTS.allowPrefixes).toContain("write");
    expect(WORKER_DEFAULTS.allowPrefixes).toContain("bash");
  });

  it("requires no approvals (deny takes precedence)", () => {
    expect(WORKER_DEFAULTS.requireApproval).toHaveLength(0);
  });

  it("has tier 'worker'", () => {
    expect(WORKER_DEFAULTS.tier).toBe("worker");
  });
});

// ─── evaluatePermission ─────────────────────────────────────────────

describe("evaluatePermission()", () => {
  it("allows any tool under coordinator defaults", () => {
    expect(evaluatePermission(COORDINATOR_DEFAULTS, "delete-everything")).toBe("allow");
    expect(evaluatePermission(COORDINATOR_DEFAULTS, "read-file")).toBe("allow");
    expect(evaluatePermission(COORDINATOR_DEFAULTS, "deploy-app")).toBe("allow");
  });

  it("deny > ask > allow precedence: deny wins over allow", () => {
    const policy: PermissionPolicy = {
      tier: "worker",
      allowPrefixes: ["*"],
      denyPrefixes: ["delete"],
      requireApproval: [],
      auditLog: false,
    };
    expect(evaluatePermission(policy, "delete-file")).toBe("deny");
  });

  it("deny > ask: deny wins over requireApproval", () => {
    const policy: PermissionPolicy = {
      tier: "interactive",
      allowPrefixes: ["*"],
      denyPrefixes: ["deploy"],
      requireApproval: ["deploy"],
      auditLog: false,
    };
    expect(evaluatePermission(policy, "deploy-app")).toBe("deny");
  });

  it("ask > allow: requireApproval wins over allow", () => {
    expect(evaluatePermission(INTERACTIVE_DEFAULTS, "delete-file")).toBe("ask");
  });

  it("returns 'allow' for tools matching allowPrefixes", () => {
    expect(evaluatePermission(INTERACTIVE_DEFAULTS, "read-file")).toBe("allow");
    expect(evaluatePermission(INTERACTIVE_DEFAULTS, "bash-command")).toBe("allow");
    expect(evaluatePermission(INTERACTIVE_DEFAULTS, "edit-code")).toBe("allow");
  });

  it("returns 'deny' for tools matching denyPrefixes (worker)", () => {
    expect(evaluatePermission(WORKER_DEFAULTS, "delete-file")).toBe("deny");
    expect(evaluatePermission(WORKER_DEFAULTS, "deploy-app")).toBe("deny");
    expect(evaluatePermission(WORKER_DEFAULTS, "force-push")).toBe("deny");
    expect(evaluatePermission(WORKER_DEFAULTS, "destroy-resource")).toBe("deny");
  });

  it("returns 'deny' when no allow prefix matches (default deny)", () => {
    const policy: PermissionPolicy = {
      tier: "worker",
      allowPrefixes: ["read"],
      denyPrefixes: [],
      requireApproval: [],
      auditLog: false,
    };
    expect(evaluatePermission(policy, "write-file")).toBe("deny");
  });

  it("is case-insensitive", () => {
    expect(evaluatePermission(WORKER_DEFAULTS, "DELETE-file")).toBe("deny");
    expect(evaluatePermission(INTERACTIVE_DEFAULTS, "READ-file")).toBe("allow");
  });
});

// ─── createPermissionPolicy ─────────────────────────────────────────

describe("createPermissionPolicy()", () => {
  it("returns defaults for a tier with no overrides", () => {
    const policy = createPermissionPolicy("coordinator");
    expect(policy).toEqual(COORDINATOR_DEFAULTS);
  });

  it("merges overrides on top of tier defaults", () => {
    const policy = createPermissionPolicy("worker", {
      auditLog: false,
    });
    expect(policy.auditLog).toBe(false);
    // Other fields should remain from defaults
    expect(policy.denyPrefixes).toEqual(WORKER_DEFAULTS.denyPrefixes);
    expect(policy.tier).toBe("worker");
  });

  it("allows overriding allowPrefixes", () => {
    const policy = createPermissionPolicy("interactive", {
      allowPrefixes: ["read", "write"],
    });
    expect(policy.allowPrefixes).toEqual(["read", "write"]);
  });

  it("preserves the tier from defaults when not overridden", () => {
    const policy = createPermissionPolicy("interactive", {
      auditLog: false,
    });
    expect(policy.tier).toBe("interactive");
  });

  it("allows overriding the tier", () => {
    const policy = createPermissionPolicy("worker", {
      tier: "coordinator",
    });
    expect(policy.tier).toBe("coordinator");
  });
});
