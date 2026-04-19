/**
 * Agent loop — observe `AgentClient` chunks and dispatch tool calls through
 * the registry, re-emitting everything as `AgentEvent`s to the caller.
 *
 * TODO (Phase 4): the one-shot `AgentClient` from Phase 1 cannot accept
 * tool_result messages as additional input to the same session. This loop
 * therefore only *observes* tool calls an agent makes and dispatches them
 * locally; it does not round-trip `tool_result` back to the LLM. True
 * multi-turn tool use (model sees result, continues reasoning) requires
 * persistent-session support — to be added when we build the interactive
 * agent client in Phase 4 and the roundtable orchestrator in Phase 5.
 */

import type { AgentChunk } from "../agent-client/index.js";
import type { AgentEvent, AgentLoopOptions, ToolResult } from "./types.js";

const DEFAULT_MAX_TURNS = 10;

/**
 * Consume an `AgentClient.send(...)` stream, dispatching tool calls through
 * the registry and re-emitting text / thinking / tool_call / tool_result /
 * error / done events.
 *
 * The loop completes when the client emits `{type:"done"}`, when `maxTurns`
 * tool-call dispatches are reached, or when the client ends its stream.
 */
export async function* runAgent(
  opts: AgentLoopOptions,
  userPrompt: string,
): AsyncIterable<AgentEvent> {
  const { client, registry, ctx } = opts;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  let toolCalls = 0;

  let stream: AsyncIterable<AgentChunk>;
  try {
    stream = client.send(userPrompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    yield { type: "error", message: `client.send failed: ${msg}` };
    yield { type: "done", reason: "error" };
    return;
  }

  try {
    for await (const chunk of stream) {
      switch (chunk.type) {
        case "text":
          yield { type: "text", content: chunk.content };
          break;

        case "thinking":
          yield { type: "thinking", content: chunk.content };
          break;

        case "tool_call": {
          toolCalls += 1;
          yield {
            type: "tool_call",
            id: chunk.id,
            tool: chunk.tool,
            input: chunk.input,
          };

          let result: ToolResult;
          if (toolCalls > maxTurns) {
            result = {
              ok: false,
              blocked: true,
              error: `maxTurns (${maxTurns}) exceeded`,
            };
          } else {
            result = await registry.execute(chunk.tool, chunk.input, ctx);
          }

          yield {
            type: "tool_result",
            id: chunk.id,
            tool: chunk.tool,
            result,
          };

          if (toolCalls > maxTurns) {
            yield { type: "done", reason: "max_turns" };
            return;
          }
          break;
        }

        case "tool_result":
          // Client-side tool results (from MCP side-channel) — surface as-is
          // but we don't have registry-level structure for them; wrap to ToolResult.
          yield {
            type: "tool_result",
            id: chunk.id,
            tool: "<client>",
            result: { ok: !chunk.isError, output: chunk.result } as ToolResult,
          };
          break;

        case "error":
          yield { type: "error", message: chunk.message };
          break;

        case "done":
          yield { type: "done", reason: chunk.reason };
          return;
      }
    }
    // Stream ended without an explicit `done` — emit one for callers.
    yield { type: "done", reason: "stop" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    yield { type: "error", message: msg };
    yield { type: "done", reason: "error" };
  }
}
