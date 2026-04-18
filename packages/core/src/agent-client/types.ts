/**
 * Agent client types — Phase 1 (CLI-spawn foundation).
 *
 * This module defines the contract for programmatic agent invocation.
 * Given an ARC profile, the dispatcher spawns the profile's native CLI tool
 * (claude, codex, gemini) with a prompt and optional MCP injection and
 * yields structured `AgentChunk`s from its streaming stdout.
 *
 * Design note (AD-1): we intentionally do NOT build a direct LLM HTTP client.
 * We orchestrate the existing agents' own tool use via MCP. Auth, retries,
 * tool schemas, and provider negotiation are handled by the native CLI.
 */

import type { AgentTool } from "../types.js";

/**
 * How a prompt is delivered to an agent process.
 * - `direct` — passed as a CLI argument or written to stdin in one-shot mode.
 *   This is the only mode used in Phase 1.
 * - `sendKeys` — line-by-line stdin write (future TUI mode, persistent session).
 * - `pasteFromFile` — write prompt to a temp file, send `/paste <file>` (future).
 */
export type InputMethod = "direct" | "sendKeys" | "pasteFromFile";

/**
 * How MCP servers are injected into an agent at launch time.
 * Mirrors Agent-Forge's `agents.json` `mcpMode` field.
 *
 * - `config-file` — write a JSON file, pass via `--mcp-config <path>` (Claude).
 * - `mcp-add` — run `<binary> mcp add --scope project <name> <cmd> [args]`
 *   before launch (Gemini).
 * - `config-args` — pass `-c mcp.servers.<name>.<field>=<value>` CLI args
 *   per server/field (Codex).
 */
export type McpConfigMode = "config-file" | "mcp-add" | "config-args";

/** Definition of a single MCP server to inject into the agent. */
export interface McpServerDef {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** An MCP injection payload — the mode plus the set of servers to register. */
export interface McpConfigInjection {
  mode: McpConfigMode;
  servers: Record<string, McpServerDef>;
}

/**
 * Structured events streamed back from an agent.
 *
 * `text` / `thinking` / `tool_call` / `tool_result` mirror Anthropic's content
 * block taxonomy; `error` is a soft failure surfaced to the caller; `done`
 * is the terminator carrying the stop reason.
 */
export type AgentChunk =
  | { type: "text"; content: string }
  | { type: "tool_call"; id: string; tool: string; input: unknown }
  | { type: "tool_result"; id: string; result: unknown; isError?: boolean }
  | { type: "thinking"; content: string }
  | { type: "error"; message: string }
  | { type: "done"; reason: "end_turn" | "max_turns" | "stop" | "error" };

/** Options accepted by `AgentClient.send`. */
export interface AgentSendOptions {
  /** MCP server(s) to inject at launch. */
  mcpConfig?: McpConfigInjection;
  /**
   * System instructions prepended to the prompt. Claude's one-shot `-p` mode
   * has no dedicated system-prompt flag, so we synthesize one by wrapping:
   *
   *   System: <instructions>
   *
   *   User: <prompt>
   *
   * Gemini and Codex follow the same wrapping for consistency.
   */
  instructions?: string;
  /** Abort signal — cancellation triggers SIGTERM on the child. */
  signal?: AbortSignal;
  /** Optional hard timeout (ms). When elapsed, the child is killed. */
  timeoutMs?: number;
}

/**
 * One-shot agent client. `send` returns an async iterable that yields
 * `AgentChunk`s until the child process exits.
 */
export interface AgentClient {
  send(prompt: string, opts?: AgentSendOptions): AsyncIterable<AgentChunk>;
  shutdown(): Promise<void>;
}

/** Output format dialect we know how to parse. */
export type AgentOutputFormat = "stream-json" | "plain" | "codex-json";

/**
 * Registry entry describing how to launch one agent in one-shot mode.
 * Ported from Agent-Forge's `agents.json`.
 */
export interface AgentProgram {
  /** Binary name on PATH. */
  command: string;
  /** Flags that put the CLI into one-shot / non-TUI mode. */
  oneShotFlags: string[];
  /** How the prompt is delivered. Phase 1 only uses `direct`. */
  inputMethod: InputMethod;
  /** MCP injection dialect. */
  mcpMode: McpConfigMode;
  /** Optional TUI readiness marker (unused in one-shot mode; kept for future). */
  readyMarker?: string;
  /** Output dialect on stdout. */
  outputFormat: AgentOutputFormat;
  /** Tool name for dispatcher lookup. */
  tool: AgentTool;
}
