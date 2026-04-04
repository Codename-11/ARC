import { describe, it, expect, beforeEach, vi } from "vitest";
import { SkillRegistry } from "../../packages/core/src/skills/registry.js";
import { mcpToSkill } from "../../packages/core/src/skills/mcp-adapter.js";
import { StuckDetector } from "../../packages/core/src/skills/stuck-detector.js";
import { detectRepeatedPatterns } from "../../packages/core/src/skills/skillify.js";
import type { Skill } from "../../packages/core/src/skills/types.js";

// Suppress log I/O during tests
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "test-skill",
    description: "A test skill",
    trigger: ["test"],
    steps: [{ action: "do-thing", description: "Does a thing", onError: "abort" }],
    tools: ["tool-a"],
    adapters: [],
    source: "builtin",
    created: new Date().toISOString(),
    successRate: 0,
    ...overrides,
  };
}

// ─── SkillRegistry ──────────────────────────────────────────────────

describe("SkillRegistry", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  describe("register()", () => {
    it("registers a skill", () => {
      const skill = makeSkill({ name: "alpha" });
      registry.register(skill);
      expect(registry.get("alpha")).toBeDefined();
    });

    it("overwrites an existing skill with the same name", () => {
      registry.register(makeSkill({ name: "alpha", description: "v1" }));
      registry.register(makeSkill({ name: "alpha", description: "v2" }));
      expect(registry.get("alpha")!.description).toBe("v2");
    });
  });

  describe("unregister()", () => {
    it("removes a registered skill and returns true", () => {
      registry.register(makeSkill({ name: "alpha" }));
      expect(registry.unregister("alpha")).toBe(true);
      expect(registry.get("alpha")).toBeUndefined();
    });

    it("returns false for a non-existent skill", () => {
      expect(registry.unregister("nope")).toBe(false);
    });
  });

  describe("get()", () => {
    it("returns the skill by exact name", () => {
      const skill = makeSkill({ name: "exact-match" });
      registry.register(skill);
      expect(registry.get("exact-match")).toEqual(skill);
    });

    it("returns undefined for unknown name", () => {
      expect(registry.get("unknown")).toBeUndefined();
    });
  });

  describe("list()", () => {
    it("returns all registered skills", () => {
      registry.register(makeSkill({ name: "a" }));
      registry.register(makeSkill({ name: "b" }));
      registry.register(makeSkill({ name: "c" }));
      expect(registry.list()).toHaveLength(3);
    });

    it("returns empty array when no skills registered", () => {
      expect(registry.list()).toHaveLength(0);
    });
  });

  describe("findByTrigger()", () => {
    it("finds skills whose trigger pattern is a substring of input", () => {
      registry.register(makeSkill({ name: "deploy", trigger: ["deploy"] }));
      registry.register(makeSkill({ name: "test", trigger: ["test"] }));

      const results = registry.findByTrigger("please deploy the app");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("deploy");
    });

    it("is case-insensitive", () => {
      registry.register(makeSkill({ name: "build", trigger: ["build"] }));
      const results = registry.findByTrigger("BUILD the project");
      expect(results).toHaveLength(1);
    });

    it("returns empty array when no triggers match", () => {
      registry.register(makeSkill({ name: "build", trigger: ["build"] }));
      const results = registry.findByTrigger("run the tests");
      expect(results).toHaveLength(0);
    });

    it("matches multiple skills if their triggers appear", () => {
      registry.register(makeSkill({ name: "build", trigger: ["build"] }));
      registry.register(makeSkill({ name: "test", trigger: ["test"] }));

      const results = registry.findByTrigger("build and test");
      expect(results).toHaveLength(2);
    });
  });
});

// ─── mcpToSkill ─────────────────────────────────────────────────────

describe("mcpToSkill()", () => {
  it("wraps an MCP tool into a Skill", () => {
    const skill = mcpToSkill({
      name: "read-file",
      description: "Reads a file from disk",
    });

    expect(skill.name).toBe("read-file");
    expect(skill.description).toBe("Reads a file from disk");
    expect(skill.source).toBe("mcp");
  });

  it("sets trigger to the tool name", () => {
    const skill = mcpToSkill({ name: "write-file", description: "Writes" });
    expect(skill.trigger).toEqual(["write-file"]);
  });

  it("creates a single step that invokes the tool", () => {
    const skill = mcpToSkill({ name: "my-tool", description: "Does stuff" });
    expect(skill.steps).toHaveLength(1);
    expect(skill.steps[0].action).toBe("invoke:my-tool");
    expect(skill.steps[0].onError).toBe("abort");
  });

  it("lists the tool name in the tools array", () => {
    const skill = mcpToSkill({ name: "my-tool", description: "Does stuff" });
    expect(skill.tools).toEqual(["my-tool"]);
  });

  it("sets adapters to empty (all compatible)", () => {
    const skill = mcpToSkill({ name: "my-tool", description: "Does stuff" });
    expect(skill.adapters).toEqual([]);
  });

  it("sets successRate to 0", () => {
    const skill = mcpToSkill({ name: "my-tool", description: "Does stuff" });
    expect(skill.successRate).toBe(0);
  });
});

// ─── StuckDetector ──────────────────────────────────────────────────

describe("StuckDetector", () => {
  let detector: StuckDetector;

  beforeEach(() => {
    detector = new StuckDetector({ maxSimilarAttempts: 3, similarityThreshold: 0.85 });
  });

  describe("isStuck()", () => {
    it("returns false when fewer than maxSimilarAttempts actions recorded", () => {
      detector.recordAction("read file.ts", "contents of file");
      detector.recordAction("read file.ts", "contents of file");
      expect(detector.isStuck()).toBe(false);
    });

    it("returns true when recent actions are highly similar", () => {
      detector.recordAction("read file.ts", "error: file not found");
      detector.recordAction("read file.ts", "error: file not found");
      detector.recordAction("read file.ts", "error: file not found");
      expect(detector.isStuck()).toBe(true);
    });

    it("returns false when actions are sufficiently different", () => {
      detector.recordAction("read file.ts", "contents of typescript file");
      detector.recordAction("write output.json", "wrote json data successfully");
      detector.recordAction("run build", "build completed with 0 errors");
      expect(detector.isStuck()).toBe(false);
    });
  });

  describe("getRecoveryStrategy()", () => {
    it("returns 'backtrack' as the first strategy", () => {
      expect(detector.getRecoveryStrategy()).toBe("backtrack");
    });

    it("cycles through strategies as history grows", () => {
      // Record enough actions to advance the stuck count
      for (let i = 0; i < 3; i++) {
        detector.recordAction("action", "output");
      }
      expect(detector.getRecoveryStrategy()).toBe("reframe");

      for (let i = 0; i < 3; i++) {
        detector.recordAction("action", "output");
      }
      expect(detector.getRecoveryStrategy()).toBe("escalate");
    });

    it("returns last strategy once end is reached", () => {
      // Record many actions to exceed strategy list length
      for (let i = 0; i < 100; i++) {
        detector.recordAction("action", "output");
      }
      expect(detector.getRecoveryStrategy()).toBe("abort");
    });
  });

  describe("reset()", () => {
    it("clears history so isStuck returns false", () => {
      detector.recordAction("read file.ts", "error");
      detector.recordAction("read file.ts", "error");
      detector.recordAction("read file.ts", "error");
      expect(detector.isStuck()).toBe(true);

      detector.reset();
      expect(detector.isStuck()).toBe(false);
    });
  });
});

// ─── detectRepeatedPatterns ─────────────────────────────────────────

describe("detectRepeatedPatterns()", () => {
  it("returns empty array when actions < 6", () => {
    const actions = [
      { tool: "read" },
      { tool: "write" },
      { tool: "build" },
    ];
    expect(detectRepeatedPatterns(actions)).toHaveLength(0);
  });

  it("detects a 3-step repeated sequence", () => {
    const actions = [
      { tool: "read" },
      { tool: "edit" },
      { tool: "build" },
      { tool: "read" },
      { tool: "edit" },
      { tool: "build" },
    ];
    const patterns = detectRepeatedPatterns(actions);
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns[0].frequency).toBeGreaterThanOrEqual(2);
    expect(patterns[0].steps).toHaveLength(3);
  });

  it("does not detect patterns that appear only once", () => {
    const actions = [
      { tool: "a" },
      { tool: "b" },
      { tool: "c" },
      { tool: "d" },
      { tool: "e" },
      { tool: "f" },
    ];
    // All unique — no 3+ step pattern repeats
    const patterns = detectRepeatedPatterns(actions);
    expect(patterns).toHaveLength(0);
  });

  it("sets steps with correct action names", () => {
    const actions = [
      { tool: "grep" },
      { tool: "read" },
      { tool: "edit" },
      { tool: "grep" },
      { tool: "read" },
      { tool: "edit" },
    ];
    const patterns = detectRepeatedPatterns(actions);
    const steps = patterns[0].steps;
    expect(steps[0].action).toBe("grep");
    expect(steps[1].action).toBe("read");
    expect(steps[2].action).toBe("edit");
  });
});
