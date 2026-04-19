/**
 * Codex one-shot agent client.
 *
 * Invocation:
 *   codex exec --json [-c mcp.servers.<n>.<f>=<v> ...] < prompt-on-stdin
 *
 * Codex reads the prompt from stdin and emits line-delimited JSON events
 * on stdout (see `parseCodexJson`). MCP injection uses `-c` config flags.
 *
 * Like Claude, `instructions` is folded into the stdin payload as a
 * `System: ... / User: ...` block — Codex doesn't have a separate
 * system-prompt CLI flag either.
 */

import type { AgentClient, AgentChunk, AgentSendOptions } from "./types.js";
import { AGENT_PROGRAMS } from "./registry.js";
import { buildMcpConfigArgs } from "./mcp-injection.js";
import { parseCodexJson } from "./stream-parsers.js";
import { runAgentProcess, type SpawnFn } from "./spawn-helpers.js";

export interface CodexAgentClientOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
  command?: string;
}

export class CodexAgentClient implements AgentClient {
  constructor(private readonly cfg: CodexAgentClientOptions = {}) {}

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
    const program = AGENT_PROGRAMS["codex"]!;
    const command = this.cfg.command ?? program.command;

    const args = [...program.oneShotFlags];
    if (opts.mcpConfig) {
      if (opts.mcpConfig.mode !== "config-args") {
        throw new Error(
          `CodexAgentClient requires mcpConfig.mode=config-args (got ${opts.mcpConfig.mode})`,
        );
      }
      args.unshift(...buildMcpConfigArgs(opts.mcpConfig));
      // Codex expects `-c ...` flags before the subcommand. But `exec` is
      // already in oneShotFlags, which we cloned before unshifting, so the
      // order ends up: -c k=v ... exec --json. That matches codex CLI usage.
    }

    const stdinPayload = opts.instructions
      ? `System: ${opts.instructions}\n\nUser: ${prompt}`
      : prompt;

    return runAgentProcess({
      command,
      args,
      env: this.cfg.env,
      cwd: this.cfg.cwd,
      stdinPayload,
      parse: parseCodexJson,
      opts,
      spawnFn: this.cfg.spawnFn,
    });
  }
}
