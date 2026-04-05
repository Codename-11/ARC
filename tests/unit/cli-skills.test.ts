import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SkillRegistry, loadSkillsFromDirectory } from "../../packages/core/src/skills/index.js";

// Suppress log I/O during tests
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

// ─── Temp dir setup ─────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-cli-skills-test-"));
  process.env["ARC_DIR"] = tmpDir;
});

afterEach(() => {
  delete process.env["ARC_DIR"];
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

// ─── Helper to write skill JSON files into the skills directory ─────

function seedSkills() {
  const skillsDir = path.join(tmpDir, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });

  const skill1 = {
    name: "deploy-app",
    description: "Deploy the application to production",
    trigger: ["deploy", "ship it"],
    steps: [
      { action: "build", description: "Build the project", onError: "abort" },
      { action: "deploy", description: "Push to production", onError: "retry" },
    ],
    tools: ["bash", "docker"],
    adapters: ["claude"],
    source: "user",
    created: new Date().toISOString(),
    successRate: 0.85,
  };

  const skill2 = {
    name: "run-tests",
    description: "Run the test suite",
    trigger: ["test", "run tests"],
    steps: [
      { action: "test", description: "Execute test runner", onError: "abort" },
    ],
    tools: ["bash"],
    adapters: [],
    source: "builtin",
    created: new Date().toISOString(),
    successRate: 0.95,
  };

  fs.writeFileSync(
    path.join(skillsDir, "deploy-app.json"),
    JSON.stringify(skill1, null, 2),
  );
  fs.writeFileSync(
    path.join(skillsDir, "run-tests.json"),
    JSON.stringify(skill2, null, 2),
  );
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("CLI skills: SkillRegistry + loader operations", () => {
  // ── list ──────────────────────────────────────────────────────

  describe("list()", () => {
    it("returns empty when no skills registered", () => {
      const registry = new SkillRegistry();
      expect(registry.list()).toEqual([]);
    });

    it("returns loaded skills after loading from directory", async () => {
      seedSkills();
      const skillsDir = path.join(tmpDir, "skills");
      const skills = await loadSkillsFromDirectory(skillsDir);
      const registry = new SkillRegistry();
      for (const skill of skills) {
        registry.register(skill);
      }

      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list.some((s) => s.name === "deploy-app")).toBe(true);
      expect(list.some((s) => s.name === "run-tests")).toBe(true);
    });

    it("skills have expected properties", async () => {
      seedSkills();
      const skillsDir = path.join(tmpDir, "skills");
      const skills = await loadSkillsFromDirectory(skillsDir);
      const registry = new SkillRegistry();
      for (const skill of skills) {
        registry.register(skill);
      }

      const list = registry.list();
      expect(list[0]).toHaveProperty("name");
      expect(list[0]).toHaveProperty("source");
      expect(list[0]).toHaveProperty("trigger");
    });

    it("filters by source via manual filtering", async () => {
      seedSkills();
      const skillsDir = path.join(tmpDir, "skills");
      const skills = await loadSkillsFromDirectory(skillsDir);
      const registry = new SkillRegistry();
      for (const skill of skills) {
        registry.register(skill);
      }

      const builtin = registry.list().filter((s) => s.source === "builtin");
      expect(builtin).toHaveLength(1);
      expect(builtin[0].name).toBe("run-tests");
      expect(builtin[0].source).toBe("builtin");
    });

    it("returns empty array for nonexistent skills directory", async () => {
      const skills = await loadSkillsFromDirectory(path.join(tmpDir, "nope"));
      expect(skills).toEqual([]);
    });
  });

  // ── info (get by name) ───────────────────────────────────────

  describe("get()", () => {
    it("returns skill detail for known skill", async () => {
      seedSkills();
      const skillsDir = path.join(tmpDir, "skills");
      const skills = await loadSkillsFromDirectory(skillsDir);
      const registry = new SkillRegistry();
      for (const skill of skills) {
        registry.register(skill);
      }

      const skill = registry.get("deploy-app");
      expect(skill).toBeDefined();
      expect(skill!.name).toBe("deploy-app");
      expect(skill!.description).toBe("Deploy the application to production");
      expect(skill!.source).toBe("user");
      expect(skill!.successRate).toBe(0.85);
      expect(skill!.steps).toHaveLength(2);
      expect(skill!.tools).toContain("bash");
      expect(skill!.tools).toContain("docker");
    });

    it("returns triggers in skill detail", async () => {
      seedSkills();
      const skillsDir = path.join(tmpDir, "skills");
      const skills = await loadSkillsFromDirectory(skillsDir);
      const registry = new SkillRegistry();
      for (const skill of skills) {
        registry.register(skill);
      }

      const skill = registry.get("deploy-app");
      expect(skill!.trigger).toContain("deploy");
      expect(skill!.trigger).toContain("ship it");
    });

    it("returns adapters in skill detail", async () => {
      seedSkills();
      const skillsDir = path.join(tmpDir, "skills");
      const skills = await loadSkillsFromDirectory(skillsDir);
      const registry = new SkillRegistry();
      for (const skill of skills) {
        registry.register(skill);
      }

      const skill = registry.get("deploy-app");
      expect(skill!.adapters).toContain("claude");
    });

    it("returns undefined for unknown skill name", () => {
      const registry = new SkillRegistry();
      expect(registry.get("nonexistent-skill")).toBeUndefined();
    });
  });
});
