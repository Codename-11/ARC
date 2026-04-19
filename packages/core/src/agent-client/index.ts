/**
 * Agent client — Phase 1 public surface.
 *
 * Re-exports types, registry helpers, per-agent clients, and the dispatcher.
 * See `./README.md` for usage.
 */

export type {
  AgentClient,
  AgentChunk,
  AgentSendOptions,
  AgentProgram,
  AgentOutputFormat,
  InputMethod,
  McpConfigMode,
  McpConfigInjection,
  McpServerDef,
} from "./types.js";

export { AGENT_PROGRAMS, resolveAgentProgram } from "./registry.js";

export {
  writeMcpConfigFile,
  buildMcpConfigArgs,
  runMcpAdd,
  cleanupMcpTempFiles,
} from "./mcp-injection.js";

export {
  parseClaudeStreamJson,
  parseCodexJson,
  parseGeminiPlain,
} from "./stream-parsers.js";

export { ClaudeAgentClient } from "./claude.js";
export { CodexAgentClient } from "./codex.js";
export { GeminiAgentClient } from "./gemini.js";

export {
  getAgentClientForProfile,
  buildProfileEnv,
  type DispatchOptions,
} from "./dispatch.js";
