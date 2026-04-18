/**
 * Claude one-shot agent client.
 *
 * Invocation:
 *   claude -p "<prompt>" --output-format stream-json --verbose [--mcp-config <file>]
 *
 * Claude's `-p` mode has no dedicated system-prompt flag, so when
 * `opts.instructions` is supplied we prepend it to the prompt with a
 * "System: ... / User: ..." wrapper — the cleanest way to give it
 * role-separated context without a TUI session.
 *
 * Output is line-delimited JSON parsed by `parseClaudeStreamJson`. The
 * client is one-shot: `shutdown()` is a no-op (the child exits on its own).
 */

import type { AgentClient, AgentChunk, AgentSendOptions } from "./types.js";
import { AGENT_PROGRAMS } from "./registry.js";
import { writeMcpConfigFile } from "./mcp-injection.js";
import { parseClaudeStreamJson } from "./stream-parsers.js";
import { runAgentProcess, type SpawnFn } from "./spawn-helpers.js";

export interface ClaudeAgentClientOptions {
  /** Optional working directory override for the child. */
  cwd?: string;
  /** Extra environment merged on top of `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Optional spawn override for tests. */
  spawnFn?: SpawnFn;
  /** Override the binary (used by tests / Windows shims). */
  command?: string;
}

export class ClaudeAgentClient implements AgentClient {
  constructor(private readonly cfg: ClaudeAgentClientOptions = {}) {}

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

  #iterate(prompt: string, opts: AgentSendOptions): AsyncIterator<AgentChunk> {
    const program = AGENT_PROGRAMS["claude"]!;
    const command = this.cfg.command ?? program.command;

    const args = [...program.oneShotFlags];

    if (opts.mcpConfig) {
      if (opts.mcpConfig.mode !== "config-file") {
        throw new Error(
          `ClaudeAgentClient requires mcpConfig.mode=config-file (got ${opts.mcpConfig.mode})`,
        );
      }
      const file = writeMcpConfigFile(opts.mcpConfig);
      args.push("--mcp-config", file);
    }

    const fullPrompt = opts.instructions
      ? `System: ${opts.instructions}\n\nUser: ${prompt}`
      : prompt;

    // Append prompt after `-p`. Claude accepts the positional prompt last.
    // The `-p` flag is already in oneShotFlags[0].
    args.push(fullPrompt);

    return runAgentProcess({
      command,
      args,
      env: this.cfg.env,
      cwd: this.cfg.cwd,
      parse: parseClaudeStreamJson,
      opts,
      spawnFn: this.cfg.spawnFn,
    });
  }
}
