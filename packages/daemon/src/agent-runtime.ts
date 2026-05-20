/**
 * Agent runtime — spawns child processes, tracks status, persists
 * lifecycle events to `agent_events`, and fans out via the Hub.
 *
 * Phase 4 scope: internal process spawning only. Adapter integration
 * (Claude Code / Codex / Gemini) lands once the daemon owns profile
 * resolution + env injection. Today we expose a small set of "builtin"
 * invocations (e.g. `_echo`) for tests + smoke scripts, plus a generic
 * command escape hatch used by orchestrators that already know the
 * argv they want.
 */

import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { DB } from "./db.js";
import type { Hub } from "./hub.js";
import type { Logger } from "./logger.js";

export {
  TERMINAL_ID_LEN,
  encodeTerminalPayload,
  decodeTerminalPayload,
} from "./terminal-frame.js";

export type AgentStatus = "starting" | "running" | "completed" | "failed" | "stopped";

export type AgentEventKind =
  | "status"
  | "stdout"
  | "stderr"
  | "exit"
  | "error"
  | "spawn";

export interface AgentEvent {
  agentId: string;
  epoch: number;
  seq: number;
  ts: number;
  kind: AgentEventKind;
  payload: Record<string, unknown>;
}

export interface AgentRunOptions {
  profile: string;
  prompt?: string;
  cwd?: string;
  worktree?: string | null;
  launchMode?: "native" | "worker";
  /**
   * Optional raw argv override — used for internal test agents and for
   * callers that already know what to spawn. When unset, falls back to
   * builtin handlers based on `profile`.
   */
  command?: { bin: string; args: string[] };
  env?: Record<string, string | undefined>;
}

export interface RunningAgent {
  id: string;
  status: AgentStatus;
  child: ChildProcess | null;
  epoch: number;
  seq: number;
  createdAt: number;
}

export interface AgentRuntimeDeps {
  db: DB;
  hub: Hub;
  logger: Logger;
  /** Fan terminal bytes to every session subscribed to `agent:<id>`. */
  broadcastTerminal: (agentId: string, bytes: Uint8Array) => void;
}

export class AgentRuntime {
  private agents = new Map<string, RunningAgent>();
  private closed = false;

  constructor(private deps: AgentRuntimeDeps) {}

  /** Insert a row in `agents`, spawn the child, return the id. */
  async run(opts: AgentRunOptions): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const launchMode = opts.launchMode ?? "worker";
    const cwd = opts.cwd ?? process.cwd();

    this.deps.db
      .prepare(
        `INSERT INTO agents (id, profile, cwd, status, launch_mode, created_at, updated_at, worktree)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, opts.profile, cwd, "starting", launchMode, now, now, opts.worktree ?? null);

    const agent: RunningAgent = {
      id,
      status: "starting",
      child: null,
      epoch: now,
      seq: 0,
      createdAt: now,
    };
    this.agents.set(id, agent);
    this.emit(agent, "status", { status: "starting", profile: opts.profile });

    // Resolve argv: either caller-provided command, builtin, or a default
    // "prompt echo" used when no real adapter is wired yet.
    const command = resolveCommand(opts);
    try {
      const child = spawn(command.bin, command.args, {
        cwd,
        env: { ...process.env, ...(opts.env ?? {}) } as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      agent.child = child;

      child.on("error", (err) => {
        this.deps.logger.warn("agent.spawn-error", { id, message: err.message });
        this.emit(agent, "error", { message: err.message });
        this.setStatus(agent, "failed");
      });

      if (!child.pid) {
        this.setStatus(agent, "failed");
        this.emit(agent, "error", { message: "spawn failed: no pid" });
        return id;
      }

      this.setStatus(agent, "running");
      this.emit(agent, "spawn", { pid: child.pid });

      child.stdout?.on("data", (chunk: Buffer) => {
        const bytes = new Uint8Array(chunk);
        this.deps.broadcastTerminal(id, bytes);
        this.emit(agent, "stdout", { bytes: chunk.length });
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        const bytes = new Uint8Array(chunk);
        this.deps.broadcastTerminal(id, bytes);
        this.emit(agent, "stderr", { bytes: chunk.length });
      });
      child.on("exit", (code, signal) => {
        const finalStatus: AgentStatus =
          agent.status === "stopped" ? "stopped" : code === 0 ? "completed" : "failed";
        this.emit(agent, "exit", { code, signal });
        this.setStatus(agent, finalStatus, { completedAt: Date.now() });
      });

      // Prompt injection: if a prompt was provided and no explicit command
      // was given, write the prompt to stdin followed by a newline. Builtins
      // like `_echo` read a single stdin line and exit.
      if (opts.prompt && !opts.command && child.stdin) {
        child.stdin.write(`${opts.prompt}\n`);
        child.stdin.end();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger.warn("agent.spawn-throw", { id, message });
      this.emit(agent, "error", { message });
      this.setStatus(agent, "failed");
    }

    return id;
  }

  /** Terminate a running agent. Returns `{ ok: true }` even if already dead. */
  async stop(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw withCode(new Error(`agent not found: ${agentId}`), "not_found");
    }
    if (agent.status === "completed" || agent.status === "failed" || agent.status === "stopped") {
      return;
    }
    agent.status = "stopped";
    if (agent.child && !agent.child.killed) {
      try {
        agent.child.kill("SIGTERM");
      } catch (err) {
        this.deps.logger.warn("agent.stop-error", {
          id: agentId,
          message: (err as Error).message,
        });
      }
    }
    this.setStatus(agent, "stopped", { completedAt: Date.now() });
  }

  /** Write text to the agent's stdin. */
  async send(agentId: string, text: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw withCode(new Error(`agent not found: ${agentId}`), "not_found");
    }
    if (!agent.child || agent.child.killed || !agent.child.stdin?.writable) {
      throw withCode(new Error(`agent stdin not writable: ${agentId}`), "bad_request");
    }
    agent.child.stdin.write(text);
  }

  /** Read the last N events for an agent from the DB. */
  replay(agentId: string, sinceEpoch?: number, sinceSeq?: number, limit = 200): AgentEvent[] {
    const rows = this.deps.db
      .prepare(
        `SELECT agent_id, epoch, seq, ts, kind, payload
         FROM agent_events
         WHERE agent_id = ?
           AND (? IS NULL OR (epoch, seq) > (?, ?))
         ORDER BY epoch ASC, seq ASC
         LIMIT ?`,
      )
      .all(
        agentId,
        sinceEpoch === undefined ? null : sinceEpoch,
        sinceEpoch ?? 0,
        sinceSeq ?? 0,
        limit,
      ) as Array<{
      agent_id: string;
      epoch: number;
      seq: number;
      ts: number;
      kind: string;
      payload: string;
    }>;
    return rows.map((r) => ({
      agentId: r.agent_id,
      epoch: r.epoch,
      seq: r.seq,
      ts: r.ts,
      kind: r.kind as AgentEventKind,
      payload: safeParseJson(r.payload),
    }));
  }

  /**
   * Stop every running child. Called during daemon shutdown. Flips the
   * `closed` flag so any late `exit` handlers become no-ops on the DB/hub.
   */
  async shutdown(): Promise<void> {
    const ids = Array.from(this.agents.keys());
    for (const id of ids) {
      const agent = this.agents.get(id);
      if (!agent) continue;
      if (agent.status === "running" || agent.status === "starting") {
        try {
          await this.stop(id);
        } catch {
          // best effort
        }
      }
    }
    this.closed = true;
  }

  // --- Internals -----------------------------------------------------------

  private emit(agent: RunningAgent, kind: AgentEventKind, payload: Record<string, unknown>): void {
    if (this.closed) return;
    agent.seq += 1;
    const event: AgentEvent = {
      agentId: agent.id,
      epoch: agent.epoch,
      seq: agent.seq,
      ts: Date.now(),
      kind,
      payload,
    };
    try {
      this.deps.db
        .prepare(
          `INSERT INTO agent_events (agent_id, epoch, seq, ts, kind, payload)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(event.agentId, event.epoch, event.seq, event.ts, event.kind, JSON.stringify(payload));
    } catch (err) {
      // DB may be closed during shutdown race — log but don't crash.
      try {
        this.deps.logger.warn("agent.event-persist-error", {
          id: agent.id,
          message: (err as Error).message,
        });
      } catch {
        // logger may also be closed
      }
    }
    try {
      this.deps.hub.publish(`agent:${agent.id}`, event);
    } catch {
      // session sinks closed during shutdown
    }
  }

  private setStatus(
    agent: RunningAgent,
    status: AgentStatus,
    extra: { completedAt?: number } = {},
  ): void {
    agent.status = status;
    if (this.closed) return;
    const now = Date.now();
    try {
      if (extra.completedAt !== undefined) {
        this.deps.db
          .prepare("UPDATE agents SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?")
          .run(status, now, extra.completedAt, agent.id);
      } else {
        this.deps.db
          .prepare("UPDATE agents SET status = ?, updated_at = ? WHERE id = ?")
          .run(status, now, agent.id);
      }
    } catch {
      // DB closed during shutdown race
    }
    this.emit(agent, "status", { status });
  }
}

function resolveCommand(opts: AgentRunOptions): { bin: string; args: string[] } {
  if (opts.command) return opts.command;
  // Builtin test profile: echoes the prompt then exits.
  if (opts.profile === "_echo") {
    return {
      bin: process.execPath,
      args: [
        "-e",
        // Node inline: read stdin, print it, exit.
        "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write(d);process.exit(0);});",
      ],
    };
  }
  // Fallback: a short-lived noop so the daemon doesn't spin on unknown profiles.
  return {
    bin: process.execPath,
    args: ["-e", "process.stdout.write('agent runtime: no adapter wired for profile\\n');"],
  };
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  return {};
}

function withCode(err: Error, code: string): Error {
  (err as Error & { code: string }).code = code;
  return err;
}
