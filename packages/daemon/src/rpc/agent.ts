import type { RpcHandler } from "./types.js";

/**
 * Agent RPCs — Phase 1 ships `agent.list` (reads from SQLite) and stubs
 * `agent.run/stop/send` with unimplemented errors. Full lifecycle wiring
 * lands in Phase 4 when adapters move behind the daemon.
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

const unimplemented: RpcHandler = () => {
  const err = new Error("agent lifecycle lands in Phase 4") as Error & { code: string };
  err.code = "unimplemented";
  throw err;
};

export const agentRun = unimplemented;
export const agentStop = unimplemented;
export const agentSend = unimplemented;
