import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../../../packages/core/src/agent/registry.js";
import type {
  PermissionMode,
  Tool,
  ToolContext,
} from "../../../packages/core/src/agent/types.js";

vi.mock("../../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

function makeCtx(
  mode: PermissionMode,
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    mode,
    confirm: vi.fn(async () => true),
    log: vi.fn(),
    ...overrides,
  };
}

function readTool(name = "reader"): Tool<{ q?: string }, { echoed: string }> {
  return {
    name,
    description: `echo read tool (${name})`,
    permission: "read",
    schema: z.object({ q: z.string().optional() }),
    handler: async (input) => ({ echoed: input.q ?? "" }),
  };
}

function writeTool(name = "writer"): Tool<{ value: string }, { written: string }> {
  return {
    name,
    description: `mutates config (${name})`,
    permission: "write",
    schema: z.object({ value: z.string() }),
    handler: async (input) => ({ written: input.value }),
  };
}

function dangerousTool(name = "bomb"): Tool<{ target: string }, { nuked: string }> {
  return {
    name,
    description: `destroys ${name}`,
    permission: "dangerous",
    schema: z.object({ target: z.string() }),
    handler: async (input) => ({ nuked: input.target }),
  };
}

describe("ToolRegistry — registration", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("registers and retrieves tools", () => {
    const tool = readTool();
    registry.register(tool);
    expect(registry.has("reader")).toBe(true);
    expect(registry.get("reader")).toBe(tool);
  });

  it("throws on duplicate registration", () => {
    registry.register(readTool());
    expect(() => registry.register(readTool())).toThrow(/already registered/);
  });

  it("list() returns all tools or filtered subset", () => {
    registry.register(readTool("r1"));
    registry.register(writeTool("w1"));
    expect(registry.list()).toHaveLength(2);
    expect(registry.list((t) => t.permission === "read")).toHaveLength(1);
  });
});

describe("ToolRegistry — getSchemas (mode filtering)", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.register(readTool("r1"));
    registry.register(writeTool("w1"));
    registry.register(dangerousTool("d1"));
  });

  it("read-only mode exposes only read tools", () => {
    const schemas = registry.getSchemas("read-only");
    const names = schemas.map((s) => s.name);
    expect(names).toEqual(["r1"]);
  });

  it("supervised mode exposes all tools", () => {
    const schemas = registry.getSchemas("supervised");
    const names = schemas.map((s) => s.name).sort();
    expect(names).toEqual(["d1", "r1", "w1"]);
  });

  it("autonomous mode exposes all tools", () => {
    const schemas = registry.getSchemas("autonomous");
    expect(schemas).toHaveLength(3);
  });

  it("derives JSON schema shape from zod", () => {
    const schemas = registry.getSchemas("supervised");
    const readerSchema = schemas.find((s) => s.name === "r1");
    expect(readerSchema?.inputSchema).toEqual({
      type: "object",
      properties: { q: { type: "string" } },
      // `q` is optional so no `required` key.
    });
    const writerSchema = schemas.find((s) => s.name === "w1");
    expect(writerSchema?.inputSchema).toMatchObject({
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    });
  });
});

describe("ToolRegistry — execute", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("returns an error result for unknown tools", async () => {
    const result = await registry.execute("nope", {}, makeCtx("supervised"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Unknown tool/);
  });

  it("validates input against zod schema", async () => {
    registry.register(writeTool());
    const result = await registry.execute(
      "writer",
      { value: 42 }, // wrong type
      makeCtx("autonomous"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Invalid input/);
  });

  it("blocks write tools under read-only mode", async () => {
    registry.register(writeTool());
    const result = await registry.execute(
      "writer",
      { value: "x" },
      makeCtx("read-only"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blocked).toBe(true);
      expect(result.error).toMatch(/read-only/);
    }
  });

  it("calls confirm for write tools under supervised mode", async () => {
    registry.register(writeTool());
    const confirm = vi.fn(async () => true);
    const ctx = makeCtx("supervised", { confirm });
    const result = await registry.execute("writer", { value: "hi" }, ctx);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toEqual({ written: "hi" });
  });

  it("returns blocked when confirmation is declined", async () => {
    registry.register(writeTool());
    const confirm = vi.fn(async () => false);
    const ctx = makeCtx("supervised", { confirm });
    const result = await registry.execute("writer", { value: "hi" }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blocked).toBe(true);
  });

  it("skips confirmation in autonomous mode", async () => {
    registry.register(dangerousTool());
    const confirm = vi.fn(async () => true);
    const ctx = makeCtx("autonomous", { confirm });
    const result = await registry.execute("bomb", { target: "x" }, ctx);
    expect(confirm).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("catches handler errors and returns ok:false", async () => {
    const broken: Tool<{ x: string }, never> = {
      name: "broken",
      description: "throws",
      permission: "read",
      schema: z.object({ x: z.string() }),
      handler: async () => {
        throw new Error("kaboom");
      },
    };
    registry.register(broken);
    const result = await registry.execute("broken", { x: "y" }, makeCtx("autonomous"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("kaboom");
  });
});
