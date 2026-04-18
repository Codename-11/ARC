import { describe, it, expect } from "vitest";
import {
  parseClaudeStreamJson,
  parseCodexJson,
  parseGeminiPlain,
} from "../../../packages/core/src/agent-client/stream-parsers.js";

// TODO Phase 1 smoke: integration tests requiring real claude/codex/gemini in CI-skipped mode

describe("parseClaudeStreamJson", () => {
  it("returns null on empty line", () => {
    expect(parseClaudeStreamJson("")).toBeNull();
    expect(parseClaudeStreamJson("   ")).toBeNull();
  });

  it("emits text chunk from content_block_delta text_delta", () => {
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello" },
    });
    expect(parseClaudeStreamJson(line)).toEqual({ type: "text", content: "Hello" });
  });

  it("unwraps event envelope and emits text chunk", () => {
    const line = JSON.stringify({
      type: "assistant",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: " world" },
      },
    });
    expect(parseClaudeStreamJson(line)).toEqual({ type: "text", content: " world" });
  });

  it("emits thinking chunk from thinking_delta", () => {
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: "pondering" },
    });
    expect(parseClaudeStreamJson(line)).toEqual({ type: "thinking", content: "pondering" });
  });

  it("returns null for message_start / content_block_start / ping", () => {
    expect(parseClaudeStreamJson(JSON.stringify({ type: "message_start" }))).toBeNull();
    expect(parseClaudeStreamJson(JSON.stringify({ type: "content_block_start" }))).toBeNull();
    expect(parseClaudeStreamJson(JSON.stringify({ type: "ping" }))).toBeNull();
    expect(parseClaudeStreamJson(JSON.stringify({ type: "content_block_stop" }))).toBeNull();
  });

  it("emits tool_call from tool_use event", () => {
    const line = JSON.stringify({
      type: "tool_use",
      id: "tool_123",
      name: "list_profiles",
      input: { filter: "all" },
    });
    expect(parseClaudeStreamJson(line)).toEqual({
      type: "tool_call",
      id: "tool_123",
      tool: "list_profiles",
      input: { filter: "all" },
    });
  });

  it("emits tool_result from tool_result event with isError flag", () => {
    const line = JSON.stringify({
      type: "tool_result",
      tool_use_id: "tool_123",
      content: "ok",
      is_error: true,
    });
    expect(parseClaudeStreamJson(line)).toEqual({
      type: "tool_result",
      id: "tool_123",
      result: "ok",
      isError: true,
    });
  });

  it("emits done on message_stop", () => {
    expect(parseClaudeStreamJson(JSON.stringify({ type: "message_stop" }))).toEqual({
      type: "done",
      reason: "end_turn",
    });
  });

  it("emits done with max_turns from message_delta", () => {
    const line = JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "max_tokens" },
    });
    expect(parseClaudeStreamJson(line)).toEqual({ type: "done", reason: "max_turns" });
  });

  it("emits error event as error chunk", () => {
    const line = JSON.stringify({ type: "error", message: "rate limited" });
    expect(parseClaudeStreamJson(line)).toEqual({ type: "error", message: "rate limited" });
  });

  it("returns null for unknown event types", () => {
    expect(parseClaudeStreamJson(JSON.stringify({ type: "totally_new_event" }))).toBeNull();
  });

  it("falls back to text chunk on non-JSON input", () => {
    expect(parseClaudeStreamJson("preamble line")).toEqual({ type: "text", content: "preamble line" });
  });
});

describe("parseCodexJson", () => {
  it("emits text from delta events", () => {
    expect(parseCodexJson(JSON.stringify({ kind: "delta", text: "hi" }))).toEqual({
      type: "text",
      content: "hi",
    });
  });

  it("accepts 'type' discriminator as well as 'kind'", () => {
    expect(parseCodexJson(JSON.stringify({ type: "delta", text: "hi" }))).toEqual({
      type: "text",
      content: "hi",
    });
  });

  it("emits text from assistant message event", () => {
    expect(
      parseCodexJson(JSON.stringify({ kind: "message", role: "assistant", text: "answer" })),
    ).toEqual({ type: "text", content: "answer" });
  });

  it("ignores non-assistant messages", () => {
    expect(
      parseCodexJson(JSON.stringify({ kind: "message", role: "system", text: "sys" })),
    ).toBeNull();
  });

  it("emits tool_call from tool_call / function_call events", () => {
    expect(
      parseCodexJson(
        JSON.stringify({ kind: "tool_call", id: "t1", name: "run", arguments: { a: 1 } }),
      ),
    ).toEqual({ type: "tool_call", id: "t1", tool: "run", input: { a: 1 } });

    expect(
      parseCodexJson(
        JSON.stringify({ kind: "function_call", id: "t2", tool: "fn", input: { b: 2 } }),
      ),
    ).toEqual({ type: "tool_call", id: "t2", tool: "fn", input: { b: 2 } });
  });

  it("emits tool_result with is_error → isError mapping", () => {
    expect(
      parseCodexJson(
        JSON.stringify({ kind: "tool_result", id: "t1", output: "done", is_error: false }),
      ),
    ).toEqual({ type: "tool_result", id: "t1", result: "done", isError: false });
  });

  it("emits thinking chunk", () => {
    expect(parseCodexJson(JSON.stringify({ kind: "thinking", text: "reason" }))).toEqual({
      type: "thinking",
      content: "reason",
    });
  });

  it("emits done on finished / done / complete", () => {
    expect(parseCodexJson(JSON.stringify({ kind: "done" }))).toEqual({
      type: "done",
      reason: "end_turn",
    });
    expect(parseCodexJson(JSON.stringify({ kind: "finished", reason: "stop" }))).toEqual({
      type: "done",
      reason: "stop",
    });
  });

  it("emits error chunk with message", () => {
    expect(parseCodexJson(JSON.stringify({ kind: "error", message: "boom" }))).toEqual({
      type: "error",
      message: "boom",
    });
  });

  it("returns null on empty line", () => {
    expect(parseCodexJson("")).toBeNull();
    expect(parseCodexJson("  ")).toBeNull();
  });

  it("falls back to text chunk on non-JSON input", () => {
    expect(parseCodexJson("raw text")).toEqual({ type: "text", content: "raw text" });
  });

  it("returns null for unknown kinds", () => {
    expect(parseCodexJson(JSON.stringify({ kind: "some_future_event" }))).toBeNull();
  });
});

describe("parseGeminiPlain", () => {
  it("passes through non-empty lines as text", () => {
    expect(parseGeminiPlain("hello")).toEqual({ type: "text", content: "hello" });
  });

  it("preserves leading whitespace", () => {
    expect(parseGeminiPlain("  indented")).toEqual({ type: "text", content: "  indented" });
  });

  it("returns null on empty line", () => {
    expect(parseGeminiPlain("")).toBeNull();
  });
});
