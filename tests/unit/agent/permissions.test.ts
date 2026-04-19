import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  canUseTool,
  needsConfirmation,
} from "../../../packages/core/src/agent/permissions.js";
import type {
  PermissionMode,
  Tool,
  ToolPermission,
} from "../../../packages/core/src/agent/types.js";

function mkTool(permission: ToolPermission): Tool {
  return {
    name: `t-${permission}`,
    description: `tool ${permission}`,
    permission,
    schema: z.object({}),
    handler: async () => ({}),
  };
}

const modes: PermissionMode[] = ["read-only", "supervised", "autonomous"];
const perms: ToolPermission[] = ["read", "write", "dangerous"];

describe("canUseTool", () => {
  it("read-only blocks write and dangerous, allows read", () => {
    expect(canUseTool(mkTool("read"), "read-only")).toBe(true);
    expect(canUseTool(mkTool("write"), "read-only")).toBe(false);
    expect(canUseTool(mkTool("dangerous"), "read-only")).toBe(false);
  });

  it("supervised allows everything", () => {
    for (const p of perms) {
      expect(canUseTool(mkTool(p), "supervised")).toBe(true);
    }
  });

  it("autonomous allows everything", () => {
    for (const p of perms) {
      expect(canUseTool(mkTool(p), "autonomous")).toBe(true);
    }
  });
});

describe("needsConfirmation", () => {
  it("only supervised + write/dangerous triggers confirmation", () => {
    for (const mode of modes) {
      for (const p of perms) {
        const expected = mode === "supervised" && (p === "write" || p === "dangerous");
        expect(needsConfirmation(mkTool(p), mode)).toBe(expected);
      }
    }
  });

  it("read tools never need confirmation", () => {
    for (const mode of modes) {
      expect(needsConfirmation(mkTool("read"), mode)).toBe(false);
    }
  });

  it("autonomous never needs confirmation (pre-trusted)", () => {
    for (const p of perms) {
      expect(needsConfirmation(mkTool(p), "autonomous")).toBe(false);
    }
  });

  it("read-only never needs confirmation (write tools are hidden)", () => {
    for (const p of perms) {
      expect(needsConfirmation(mkTool(p), "read-only")).toBe(false);
    }
  });
});
