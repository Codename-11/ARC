import { describe, it, expect } from "vitest";
import {
  ARC_KNOWLEDGE,
  COMMANDS_CATALOG,
  type CommandCategory,
} from "../../../packages/core/src/knowledge/static.js";

describe("COMMANDS_CATALOG", () => {
  it("contains the key commands required for Phase 3", () => {
    const names = COMMANDS_CATALOG.map((c) => c.name);
    const required = [
      "profile list",
      "profile show",
      "profile switch",
      "profile create",
      "profile clone",
      "profile delete",
      "profile import",
      "profile export",
      "profile import-file",
      "profile clear-active",
      "launch",
      "launch --bare",
      "launch --native",
      "launch --worker",
      "run",
      "doctor",
      "logs",
      "backup create",
      "backup restore",
      "backup list",
      "shared pull",
      "shared push",
      "mcp connect",
      "mcp list",
      "swap capture",
      "swap to",
      "instructions show",
      "instructions set",
      "instructions edit",
      "instructions clear",
      "provider set",
      "provider show",
      "provider clear",
      "provider presets",
      "dashboard",
      "which",
      "shell-init",
      "update",
    ];
    for (const r of required) {
      expect(names).toContain(r);
    }
  });

  it("has no duplicate command names", () => {
    const names = COMMANDS_CATALOG.map((c) => c.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("every command has a non-empty description and a valid category", () => {
    const validCategories: CommandCategory[] = [
      "profile",
      "launch",
      "diagnostic",
      "orchestration",
      "data",
      "utility",
    ];
    for (const cmd of COMMANDS_CATALOG) {
      expect(cmd.description.trim().length).toBeGreaterThan(0);
      expect(validCategories).toContain(cmd.category);
    }
  });

  it("example commands start with `arc `", () => {
    for (const cmd of COMMANDS_CATALOG) {
      for (const ex of cmd.examples ?? []) {
        expect(ex.startsWith("arc ")).toBe(true);
      }
    }
  });

  it("exposes purpose, architecture, concepts, commands, and docLinks on ARC_KNOWLEDGE", () => {
    expect(ARC_KNOWLEDGE.purpose.length).toBeGreaterThan(400);
    expect(ARC_KNOWLEDGE.architecture.length).toBeGreaterThan(600);
    expect(Object.keys(ARC_KNOWLEDGE.concepts).length).toBeGreaterThanOrEqual(10);
    expect(ARC_KNOWLEDGE.commands).toBe(COMMANDS_CATALOG);
    expect(Object.keys(ARC_KNOWLEDGE.docLinks).length).toBeGreaterThan(0);
  });
});
