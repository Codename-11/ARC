/**
 * In-memory shared bus for team tools.
 *
 * Scope limitation (Phase 6): the MCP SDK's stdio transport does not surface a
 * session id per tool invocation, so a single process-wide bus is used. All
 * team tools mounted on the same MCP server instance share state; if you need
 * per-team isolation, spawn separate MCP server processes.
 *
 * The bus reuses `InMemoryMessageBus` from `@axiom-labs/arc-core/orchestration`
 * for messages and maintains a separate in-memory registry of agent statuses.
 */

import { randomUUID } from "node:crypto";
import {
  InMemoryMessageBus,
  type StagedMessage,
} from "@axiom-labs/arc-core";

export type TeamAgentStatus = "working" | "done" | "stalled" | "idle";

export interface TeamAgentState {
  name: string;
  status: TeamAgentStatus;
  summary?: string;
  updatedAt: number;
}

export interface TeamMessageMeta {
  tag?: "plan" | "dm" | "done" | "say";
  priority?: "urgent" | "normal" | "low";
  to?: string;
}

/**
 * Wrapper over InMemoryMessageBus + agent status registry. `from` defaults to
 * `"mcp"` when no caller identity is available (the MCP SDK does not expose
 * one today).
 */
export class TeamSessionStore {
  readonly messages = new InMemoryMessageBus();
  private readonly agents = new Map<string, TeamAgentState>();
  private readonly metaById = new Map<string, TeamMessageMeta>();
  private counter = 0;

  /** Post a message, associate metadata, return the stored message. */
  async post(
    content: string,
    meta: TeamMessageMeta,
    from: string = "mcp",
  ): Promise<StagedMessage> {
    const msg: StagedMessage = {
      id: `team-${++this.counter}-${randomUUID().slice(0, 8)}`,
      from,
      content,
      createdAt: Date.now(),
    };
    this.metaById.set(msg.id, meta);
    await this.messages.post(msg);
    return msg;
  }

  /** Read new messages since `cursor`. */
  async read(cursor: number = 0): Promise<{
    messages: (StagedMessage & { meta?: TeamMessageMeta })[];
    cursor: number;
  }> {
    const res = await this.messages.getMessages(cursor);
    return {
      messages: res.messages.map((m) => ({
        ...m,
        meta: this.metaById.get(m.id),
      })),
      cursor: res.cursor,
    };
  }

  setStatus(
    name: string,
    status: TeamAgentStatus,
    summary?: string,
  ): TeamAgentState {
    const now = Date.now();
    const entry: TeamAgentState = { name, status, summary, updatedAt: now };
    this.agents.set(name, entry);
    return entry;
  }

  listAgents(): TeamAgentState[] {
    return Array.from(this.agents.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /** Test-only helper. */
  reset(): void {
    this.agents.clear();
    this.metaById.clear();
    this.counter = 0;
    // InMemoryMessageBus has no reset — just replace it.
    (this as unknown as { messages: InMemoryMessageBus }).messages =
      new InMemoryMessageBus();
  }
}

/**
 * Singleton shared bus for the current MCP server process.
 *
 * We export both the class (for tests) and a module-level instance (for
 * registrars). Tests that need isolation should call `.reset()`.
 */
export const teamBus = new TeamSessionStore();
