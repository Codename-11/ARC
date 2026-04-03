import { describe, expect, it, vi } from "vitest";
import register from "../../packages/adapter-openclaw/src/plugin.js";
import type { OpenClawPluginApi, OpenClawToolDefinition, ToolRegistrationOptions, HookMeta } from "../../packages/adapter-openclaw/src/types.js";

function createMockApi(): OpenClawPluginApi & {
  _hooks: Array<{ event: string; handler: Function; meta: HookMeta }>;
  _tools: Array<{ tool: OpenClawToolDefinition; options?: ToolRegistrationOptions }>;
} {
  const hooks: Array<{ event: string; handler: Function; meta: HookMeta }> = [];
  const tools: Array<{ tool: OpenClawToolDefinition; options?: ToolRegistrationOptions }> = [];

  return {
    registerHook: vi.fn((event: string, handler: Function, meta: HookMeta) => {
      hooks.push({ event, handler, meta });
    }),
    registerTool: vi.fn((tool: OpenClawToolDefinition, options?: ToolRegistrationOptions) => {
      tools.push({ tool, options });
    }),
    config: { profileName: "test" },
    _hooks: hooks,
    _tools: tools,
  };
}

describe("OpenClaw plugin registration", () => {
  it("register() calls registerHook 3 times", () => {
    const api = createMockApi();
    register(api);
    expect(api.registerHook).toHaveBeenCalledTimes(3);
  });

  it("register() calls registerTool 5 times", () => {
    const api = createMockApi();
    register(api);
    expect(api.registerTool).toHaveBeenCalledTimes(5);
  });

  it("registers hooks with correct event names", () => {
    const api = createMockApi();
    register(api);
    const events = api._hooks.map((h) => h.event);
    expect(events).toContain("before_prompt_build");
    expect(events).toContain("agent_end");
    expect(events).toContain("session_end");
  });

  it("registers tools with correct names", () => {
    const api = createMockApi();
    register(api);
    const names = api._tools.map((t) => t.tool.name);
    expect(names).toContain("arc_expand_intent");
    expect(names).toContain("arc_classify_risk");
    expect(names).toContain("arc_derive_completion");
    expect(names).toContain("arc_audit_completion");
    expect(names).toContain("arc_explain_trace");
  });

  it("all tools registered with { optional: true }", () => {
    const api = createMockApi();
    register(api);
    for (const entry of api._tools) {
      expect(entry.options).toEqual({ optional: true });
    }
  });
});

describe("OpenClaw hook handlers", () => {
  it("beforePromptBuild returns { prepend, append } strings", async () => {
    const api = createMockApi();
    register(api);
    const hook = api._hooks.find((h) => h.event === "before_prompt_build");
    expect(hook).toBeDefined();
    const result = await hook!.handler({ sessionId: "test-session" });
    expect(result).toHaveProperty("prepend");
    expect(result).toHaveProperty("append");
    expect(typeof result.prepend).toBe("string");
    expect(result.append).toBe("");
  });

  it("agentEnd returns { continue: boolean }", async () => {
    const api = createMockApi();
    register(api);
    const hook = api._hooks.find((h) => h.event === "agent_end");
    expect(hook).toBeDefined();
    const result = await hook!.handler({ sessionId: "test-session", reason: "done" });
    expect(result).toHaveProperty("continue");
    expect(typeof result.continue).toBe("boolean");
  });

  it("sessionEnd returns void", () => {
    const api = createMockApi();
    register(api);
    const hook = api._hooks.find((h) => h.event === "session_end");
    expect(hook).toBeDefined();
    const result = hook!.handler({ sessionId: "test-session" });
    expect(result).toBeUndefined();
  });
});

describe("OpenClaw tool execute functions", () => {
  it("arc_expand_intent returns MCP-like content structure", async () => {
    const api = createMockApi();
    register(api);
    const tool = api._tools.find((t) => t.tool.name === "arc_expand_intent");
    expect(tool).toBeDefined();
    const result = await tool!.tool.execute("test-id", { intent: "deploy app" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.intent).toBe("deploy app");
    expect(parsed.stub).toBe(true);
  });

  it("arc_classify_risk returns tier and reason", async () => {
    const api = createMockApi();
    register(api);
    const tool = api._tools.find((t) => t.tool.name === "arc_classify_risk");
    expect(tool).toBeDefined();
    const result = await tool!.tool.execute("test-id", { action: "delete file" });
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tier).toBe("low");
    expect(parsed.reason).toBe("stub");
  });

  it("arc_derive_completion returns derived criteria", async () => {
    const api = createMockApi();
    register(api);
    const tool = api._tools.find((t) => t.tool.name === "arc_derive_completion");
    expect(tool).toBeDefined();
    const result = await tool!.tool.execute("test-id", { task: "build feature" });
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.task).toBe("build feature");
    expect(parsed.derived).toBe(true);
    expect(parsed.stub).toBe(true);
  });

  it("arc_audit_completion returns audit result", async () => {
    const api = createMockApi();
    register(api);
    const tool = api._tools.find((t) => t.tool.name === "arc_audit_completion");
    expect(tool).toBeDefined();
    const result = await tool!.tool.execute("test-id", {
      task: "build feature",
      result: "feature built",
    });
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.task).toBe("build feature");
    expect(parsed.result).toBe("feature built");
    expect(parsed.passed).toBe(true);
    expect(parsed.stub).toBe(true);
  });

  it("arc_explain_trace returns trace explanation", async () => {
    const api = createMockApi();
    register(api);
    const tool = api._tools.find((t) => t.tool.name === "arc_explain_trace");
    expect(tool).toBeDefined();
    const result = await tool!.tool.execute("test-id", { traceId: "trace-123" });
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.traceId).toBe("trace-123");
    expect(parsed.stub).toBe(true);
  });
});
