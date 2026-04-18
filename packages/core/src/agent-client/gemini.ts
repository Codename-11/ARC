/**
 * Gemini one-shot agent client.
 *
 * Invocation:
 *   gemini -p "<prompt>"
 *
 * Gemini's `-p` mode prints plain text with no structured tool events on
 * stdout — tool use flows through the MCP side-channel registered via
 * `gemini mcp add ...` before launch. For this phase we just stream text
 * lines and emit `{type:"done"}` on process exit.
 */

import type { AgentClient, AgentChunk, AgentSendOptions } from "./types.js";
import { AGENT_PROGRAMS } from "./registry.js";
import { runMcpAdd } from "./mcp-injection.js";
import { parseGeminiPlain } from "./stream-parsers.js";
import { runAgentProcess, type SpawnFn } from "./spawn-helpers.js";

export interface GeminiAgentClientOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
  command?: string;
  /** When false, skip pre-launch `gemini mcp add` (tests). */
  autoRegisterMcp?: boolean;
}

export class GeminiAgentClient implements AgentClient {
  constructor(private readonly cfg: GeminiAgentClientOptions = {}) {}

  send(prompt: string, opts?: AgentSendOptions): AsyncIterable<AgentChunk> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentChunk> {
        return self.#iterate(prompt, opts ?? {});
      },
    };
  }

  async shutdown(): Promise<void> {
    // One-shot: nothing to tear down.
  }

  async *#iterate(prompt: string, opts: AgentSendOptions): AsyncGenerator<AgentChunk, void, void> {
    const program = AGENT_PROGRAMS["gemini"]!;
    const command = this.cfg.command ?? program.command;

    if (opts.mcpConfig && this.cfg.autoRegisterMcp !== false) {
      if (opts.mcpConfig.mode !== "mcp-add") {
        throw new Error(
          `GeminiAgentClient requires mcpConfig.mode=mcp-add (got ${opts.mcpConfig.mode})`,
        );
      }
      await runMcpAdd(opts.mcpConfig, command);
    }

    const fullPrompt = opts.instructions
      ? `System: ${opts.instructions}\n\nUser: ${prompt}`
      : prompt;

    const args = [...program.oneShotFlags, fullPrompt];

    yield* runAgentProcess({
      command,
      args,
      env: this.cfg.env,
      cwd: this.cfg.cwd,
      parse: parseGeminiPlain,
      opts,
      spawnFn: this.cfg.spawnFn,
    });
  }
}
