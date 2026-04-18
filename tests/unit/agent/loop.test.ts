import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../../../packages/core/src/agent/registry.js";
import { runAgent } from "../../../packages/core/src/agent/loop.js";
import type {
  AgentEvent,
  Tool,
  ToolContext,
} from "../../../packages/core/src/agent/types.js";
import type {
  AgentChunk,
  AgentClient,
} from "../../../packages/core/src/agent-client/index.js";

vi.mock("../../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

// A tiny mock client that replays a scripted AgentChunk stream.
function mockClient(chunks: AgentChunk[]): AgentClient {
  return {
    async *send() {
      for (const c of chunks) yield c;
    },
    async shutdown() {},
  };
}

const echoTool: Tool<{ value: string }, { echoed: string }> = {
  name: "echo",
  description: "return the input value",
  permission: "read",
  schema: z.object({ value: z.string() }),
  handler: async ({ value }) => ({ echoed: value }),
};

function makeCtx(): ToolContext {
  return {
    mode: "supervised",
    confirm: vi.fn(async () => true),
    log: vi.fn(),
  };
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

describe("runAgent loop", () => {
  it("emits text chunks and terminates on done", async () => {
    const registry = new ToolRegistry();
    const client = mockClient([
      { type: "text", content: "hello" },
      { type: "text", content: " world" },
      { type: "done", reason: "end_turn" },
    ]);
    const events = await collect(
      runAgent({ client, registry, ctx: makeCtx() }, "say hi"),
    );
    expect(events.map((e) => e.type)).toEqual(["text", "text", "done"]);
    const done = events.at(-1);
    if (done?.type === "done") expect(done.reason).toBe("end_turn");
  });

  it("dispatches tool_call through registry and emits tool_result", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const client = mockClient([
      { type: "tool_call", id: "c1", tool: "echo", input: { value: "hi" } },
      { type: "done", reason: "end_turn" },
    ]);
    const events = await collect(runAgent({ client, registry, ctx: makeCtx() }, "do it"));

    const call = events.find((e) => e.type === "tool_call");
    const result = events.find((e) => e.type === "tool_result");
    expect(call).toBeDefined();
    expect(result).toBeDefined();
    if (result?.type === "tool_result") {
      expect(result.tool).toBe("echo");
      expect(result.result.ok).toBe(true);
      if (result.result.ok) {
        expect(result.result.output).toEqual({ echoed: "hi" });
      }
    }
  });

  it("surfaces unknown-tool errors via tool_result", async () => {
    const registry = new ToolRegistry();
    const client = mockClient([
      { type: "tool_call", id: "c1", tool: "missing", input: {} },
      { type: "done", reason: "end_turn" },
    ]);
    const events = await collect(runAgent({ client, registry, ctx: makeCtx() }, "?"));
    const result = events.find((e) => e.type === "tool_result");
    if (result?.type === "tool_result") {
      expect(result.result.ok).toBe(false);
    }
  });

  it("enforces maxTurns cap", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const client = mockClient([
      { type: "tool_call", id: "c1", tool: "echo", input: { value: "a" } },
      { type: "tool_call", id: "c2", tool: "echo", input: { value: "b" } },
      { type: "tool_call", id: "c3", tool: "echo", input: { value: "c" } },
      { type: "done", reason: "end_turn" },
    ]);
    const events = await collect(
      runAgent({ client, registry, ctx: makeCtx(), maxTurns: 1 }, "loop"),
    );
    const done = events.at(-1);
    if (done?.type === "done") expect(done.reason).toBe("max_turns");
    // First call completes, second trips the cap and emits blocked result + done.
    const results = events.filter((e) => e.type === "tool_result");
    expect(results.length).toBe(2);
  });

  it("emits synthetic done:stop when stream ends without explicit done", async () => {
    const registry = new ToolRegistry();
    const client = mockClient([{ type: "text", content: "partial" }]);
    const events = await collect(runAgent({ client, registry, ctx: makeCtx() }, "..."));
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type === "done") expect(done.reason).toBe("stop");
  });

  it("handles client.send throwing synchronously", async () => {
    const registry = new ToolRegistry();
    const client: AgentClient = {
      send: () => {
        throw new Error("boom");
      },
      shutdown: async () => {},
    };
    const events = await collect(runAgent({ client, registry, ctx: makeCtx() }, "go"));
    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    if (err?.type === "error") expect(err.message).toMatch(/boom/);
    const done = events.at(-1);
    if (done?.type === "done") expect(done.reason).toBe("error");
  });

  it("propagates thinking chunks", async () => {
    const registry = new ToolRegistry();
    const client = mockClient([
      { type: "thinking", content: "hmm" },
      { type: "text", content: "ok" },
      { type: "done", reason: "end_turn" },
    ]);
    const events = await collect(runAgent({ client, registry, ctx: makeCtx() }, "?"));
    expect(events.some((e) => e.type === "thinking")).toBe(true);
  });
});
