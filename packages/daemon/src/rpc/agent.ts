import {
  AgentAttachParams,
  AgentRunParams,
  AgentSendParams,
  AgentStopParams,
} from "@axiom-labs/arc-client";
import type { RpcHandler } from "./types.js";

/**
 * Agent RPCs — Phase 4 wiring.
 * - `agent.list`: reads from SQLite `agents`.
 * - `agent.run` / `agent.stop` / `agent.send`: delegate to `AgentRuntime`.
 * - `agent.attach`: returns the most recent events for an agent and lets the
 *   caller subscribe to `agent:<id>` for live updates.
 */

export const agentList: RpcHandler = (_params, ctx) => {
  const rows = ctx.db
    .prepare(
      `SELECT id, profile, cwd, status, launch_mode, created_at, updated_at, completed_at, worktree
       FROM agents ORDER BY updated_at DESC LIMIT 200`,
    )
    .all() as Array<{
    id: string;
    profile: string;
    cwd: string;
    status: string;
    launch_mode: string;
    created_at: number;
    updated_at: number;
    completed_at: number | null;
    worktree: string | null;
  }>;
  return {
    agents: rows.map((r) => ({
      id: r.id,
      profile: r.profile,
      cwd: r.cwd,
      status: r.status,
      launchMode: r.launch_mode,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at,
      worktree: r.worktree,
    })),
  };
};

export const agentRun: RpcHandler = async (raw, ctx) => {
  const params = AgentRunParams.parse(raw);
  const agentId = await ctx.runtime.run({
    profile: params.profile,
    prompt: params.prompt,
    cwd: params.cwd,
    worktree: params.worktree ?? null,
    launchMode: params.launchMode,
  });
  return { agentId };
};

export const agentStop: RpcHandler = async (raw, ctx) => {
  const { agentId } = AgentStopParams.parse(raw);
  await ctx.runtime.stop(agentId);
  return { ok: true as const };
};

export const agentSend: RpcHandler = async (raw, ctx) => {
  const { agentId, text } = AgentSendParams.parse(raw);
  await ctx.runtime.send(agentId, text);
  return { ok: true as const };
};

export const agentAttach: RpcHandler = (raw, ctx) => {
  const params = AgentAttachParams.parse(raw);
  const events = ctx.runtime.replay(
    params.agentId,
    params.sinceEpoch,
    params.sinceSeq,
    params.limit ?? 200,
  );
  const row = ctx.db
    .prepare("SELECT status FROM agents WHERE id = ?")
    .get(params.agentId) as { status: string } | undefined;
  if (!row) {
    const err = new Error(`agent not found: ${params.agentId}`) as Error & { code: string };
    err.code = "not_found";
    throw err;
  }
  return {
    agentId: params.agentId,
    status: row.status,
    events,
  };
};
