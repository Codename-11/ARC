/**
 * Stream parsers — convert a single line of agent stdout into an `AgentChunk`.
 *
 * Each parser is pure: (line) -> AgentChunk | null. The caller (the per-agent
 * client) is responsible for buffering partial lines via `readline` and for
 * emitting the terminal `{ type: "done" }` chunk when the child process exits.
 *
 * We tolerate unknown shapes by returning `null` — the client skips silently
 * instead of crashing on an event the upstream CLI added in a newer version.
 */

import type { AgentChunk } from "./types.js";

// ─── Claude (Anthropic SDK stream-json) ────────────────────────────────

/**
 * Parse one line from `claude -p --output-format stream-json --verbose`.
 *
 * The Anthropic Messages streaming format wraps content blocks in events:
 *   - `message_start` — we ignore (no chunk to emit).
 *   - `content_block_start` — opens a text/tool_use/thinking block.
 *   - `content_block_delta` — text_delta / input_json_delta / thinking_delta.
 *   - `content_block_stop` — closes a block (ignored).
 *   - `message_delta` — carries stop_reason.
 *   - `message_stop` — end of turn.
 *
 * claude's CLI wraps this with its own envelope:
 *   { type: "assistant", message: { content: [...] } }  (snapshot)
 *   { type: "assistant", event: { type: "content_block_delta", delta: {...} } }
 *
 * Both shapes are handled defensively.
 */
export function parseClaudeStreamJson(line: string): AgentChunk | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Not JSON — surface as text (claude sometimes emits preamble text).
    return { type: "text", content: trimmed };
  }

  // Unwrap claude's outer "event" envelope if present.
  const event = (isObject(obj["event"]) ? (obj["event"] as Record<string, unknown>) : obj);
  const evType = typeof event["type"] === "string" ? (event["type"] as string) : undefined;

  // Top-level result envelope that claude emits on completion.
  if (obj["type"] === "result" || evType === "result") {
    const reason = coerceStopReason((obj["stop_reason"] ?? event["stop_reason"]) as unknown);
    return { type: "done", reason };
  }

  switch (evType) {
    case "message_start":
    case "content_block_start":
    case "content_block_stop":
    case "ping":
      return null;

    case "content_block_delta": {
      const delta = event["delta"] as Record<string, unknown> | undefined;
      if (!delta) return null;
      if (delta["type"] === "text_delta" && typeof delta["text"] === "string") {
        return { type: "text", content: delta["text"] };
      }
      if (delta["type"] === "thinking_delta" && typeof delta["thinking"] === "string") {
        return { type: "thinking", content: delta["thinking"] };
      }
      if (delta["type"] === "input_json_delta") {
        // Partial tool input — no complete chunk yet.
        return null;
      }
      return null;
    }

    case "tool_use": {
      const id = typeof event["id"] === "string" ? event["id"] : "";
      const name = typeof event["name"] === "string" ? event["name"] : "";
      return { type: "tool_call", id, tool: name, input: event["input"] ?? {} };
    }

    case "tool_result": {
      const id = typeof event["tool_use_id"] === "string" ? event["tool_use_id"] : "";
      const isError = event["is_error"] === true;
      return { type: "tool_result", id, result: event["content"] ?? null, isError };
    }

    case "message_delta": {
      const delta = event["delta"] as Record<string, unknown> | undefined;
      const reason = coerceStopReason(delta?.["stop_reason"]);
      // Only emit done once we actually have a stop reason.
      if (delta && delta["stop_reason"]) return { type: "done", reason };
      return null;
    }

    case "message_stop":
      return { type: "done", reason: "end_turn" };

    case "error": {
      const msg = typeof event["message"] === "string" ? event["message"] : "unknown error";
      return { type: "error", message: msg };
    }

    default:
      return null;
  }
}

// ─── Codex (`codex exec --json`) ───────────────────────────────────────

/**
 * Parse one line from `codex exec --json`.
 *
 * Codex emits heterogenous event objects; the shape has drifted between
 * versions. We do best-effort mapping based on recognizable keys:
 *   - `{ kind: "message", role: "assistant", text }`
 *   - `{ kind: "delta", text }`
 *   - `{ kind: "tool_call", id, name, arguments }`
 *   - `{ kind: "tool_result", id, output, is_error }`
 *   - `{ kind: "done" | "finished" | "complete", reason }`
 *
 * Older codex builds use `type` instead of `kind`; we accept both.
 */
export function parseCodexJson(line: string): AgentChunk | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return { type: "text", content: trimmed };
  }

  const kind = (typeof obj["kind"] === "string"
    ? obj["kind"]
    : typeof obj["type"] === "string"
      ? obj["type"]
      : "") as string;

  switch (kind) {
    case "delta":
    case "token":
    case "text": {
      const text = typeof obj["text"] === "string"
        ? (obj["text"] as string)
        : typeof obj["content"] === "string"
          ? (obj["content"] as string)
          : null;
      return text !== null ? { type: "text", content: text } : null;
    }

    case "message": {
      const text = typeof obj["text"] === "string"
        ? (obj["text"] as string)
        : typeof obj["content"] === "string"
          ? (obj["content"] as string)
          : null;
      if (obj["role"] === "assistant" && text !== null) {
        return { type: "text", content: text };
      }
      return null;
    }

    case "tool_call":
    case "function_call": {
      const id = typeof obj["id"] === "string" ? obj["id"] : "";
      const name = typeof obj["name"] === "string"
        ? (obj["name"] as string)
        : typeof obj["tool"] === "string"
          ? (obj["tool"] as string)
          : "";
      const input = obj["arguments"] ?? obj["input"] ?? {};
      return { type: "tool_call", id, tool: name, input };
    }

    case "tool_result":
    case "function_result": {
      const id = typeof obj["id"] === "string" ? obj["id"] : "";
      const isError = obj["is_error"] === true || obj["isError"] === true;
      return { type: "tool_result", id, result: obj["output"] ?? obj["result"] ?? null, isError };
    }

    case "thinking":
    case "reasoning": {
      const text = typeof obj["text"] === "string"
        ? (obj["text"] as string)
        : typeof obj["content"] === "string"
          ? (obj["content"] as string)
          : "";
      return { type: "thinking", content: text };
    }

    case "done":
    case "finished":
    case "complete": {
      const reason = coerceStopReason(obj["reason"] ?? obj["stop_reason"]);
      return { type: "done", reason };
    }

    case "error": {
      const msg = typeof obj["message"] === "string"
        ? (obj["message"] as string)
        : typeof obj["error"] === "string"
          ? (obj["error"] as string)
          : "codex error";
      return { type: "error", message: msg };
    }

    default:
      return null;
  }
}

// ─── Gemini (plain text passthrough) ───────────────────────────────────

/**
 * Gemini in `-p` mode prints plain text with no structured events.
 * Every non-empty line becomes a text chunk. The client emits a terminal
 * `{ type: "done", reason: "end_turn" }` on process close; we never emit it
 * from inside this parser.
 */
export function parseGeminiPlain(line: string): AgentChunk | null {
  // Preserve the line exactly (including leading whitespace) — some tools
  // emit significant indentation — but drop fully empty lines.
  if (line.length === 0) return null;
  return { type: "text", content: line };
}

// ─── Helpers ───────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function coerceStopReason(v: unknown): "end_turn" | "max_turns" | "stop" | "error" {
  if (v === "end_turn" || v === "max_turns" || v === "stop" || v === "error") return v;
  if (typeof v === "string") {
    if (v.includes("max")) return "max_turns";
    if (v.includes("error") || v.includes("fail")) return "error";
    if (v.includes("stop")) return "stop";
  }
  return "end_turn";
}
