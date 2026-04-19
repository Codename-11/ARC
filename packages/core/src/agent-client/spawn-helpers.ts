/**
 * Internal spawn + stream helpers shared by claude.ts / codex.ts / gemini.ts.
 *
 * We intentionally avoid `spawnManagedProcess` from `../process.ts` here —
 * that helper is intended for long-lived adapters, logs every spawn, and
 * uses process-group semantics. The agent client needs a much lighter
 * "spawn, read lines, kill on abort, done" primitive.
 */

import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentChunk, AgentSendOptions } from "./types.js";

/**
 * Inject for tests — swap the child_process `spawn` implementation without
 * touching global state. Tests pass a fake that returns a stub `ChildProcess`
 * with programmable stdout / exit.
 */
export type SpawnFn = typeof spawn;

/**
 * Spawn the agent binary and return an async iterable of parsed chunks.
 *
 * - `parse(line)` converts each stdout line into `AgentChunk | null`.
 * - On child close, emits a terminal `{ type: "done" }` chunk unless the
 *   parser already emitted one.
 * - Honors `opts.signal` and `opts.timeoutMs`.
 */
export async function* runAgentProcess(params: {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdinPayload?: string; // prompt written to stdin (codex)
  parse: (line: string) => AgentChunk | null;
  opts?: AgentSendOptions;
  spawnFn?: SpawnFn;
}): AsyncGenerator<AgentChunk, void, void> {
  const spawnImpl = params.spawnFn ?? spawn;
  const spawnOpts: SpawnOptionsWithoutStdio = {
    cwd: params.cwd,
    env: params.env ?? process.env,
    windowsHide: true,
    // Intentionally no `shell: true` — we're passing args through as-is.
  };

  const child = spawnImpl(params.command, params.args, spawnOpts) as ChildProcessWithoutNullStreams;

  // ── Abort + timeout plumbing ──
  const abortHandler = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already dead */
    }
  };
  if (params.opts?.signal) {
    if (params.opts.signal.aborted) abortHandler();
    else params.opts.signal.addEventListener("abort", abortHandler, { once: true });
  }

  let timeoutHandle: NodeJS.Timeout | undefined;
  let timedOut = false;
  if (params.opts?.timeoutMs && params.opts.timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortHandler();
    }, params.opts.timeoutMs);
  }

  // ── Deliver prompt via stdin if configured ──
  if (params.stdinPayload !== undefined && child.stdin) {
    try {
      child.stdin.end(params.stdinPayload);
    } catch {
      /* ignore — child may have died */
    }
  } else if (child.stdin) {
    // close stdin so the child doesn't hang waiting for input
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
  }

  // ── Buffer + forward chunks ──
  const queue: AgentChunk[] = [];
  let resolveWaiter: (() => void) | null = null;
  let finished = false;
  let spawnError: Error | null = null;
  let emittedDone = false;

  const push = (chunk: AgentChunk) => {
    if (chunk.type === "done") emittedDone = true;
    queue.push(chunk);
    resolveWaiter?.();
    resolveWaiter = null;
  };

  const stdoutRl = createInterface({ input: child.stdout });
  stdoutRl.on("line", (line) => {
    try {
      const chunk = params.parse(line);
      if (chunk) push(chunk);
    } catch (err) {
      push({ type: "error", message: (err as Error).message });
    }
  });

  // Capture stderr as soft errors so callers can surface them.
  let stderrBuf = "";
  child.stderr.on("data", (b: Buffer) => {
    stderrBuf += b.toString("utf8");
  });

  child.on("error", (err) => {
    spawnError = err;
  });

  child.on("close", (code) => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (!emittedDone) {
      if (spawnError) {
        push({ type: "error", message: spawnError.message });
        push({ type: "done", reason: "error" });
      } else if (timedOut) {
        push({ type: "error", message: "agent process timed out" });
        push({ type: "done", reason: "error" });
      } else if (code === 0) {
        push({ type: "done", reason: "end_turn" });
      } else {
        if (stderrBuf.trim()) {
          push({ type: "error", message: stderrBuf.trim().slice(0, 2000) });
        }
        push({ type: "done", reason: code === null ? "stop" : "error" });
      }
    }
    finished = true;
    resolveWaiter?.();
    resolveWaiter = null;
  });

  // ── Consumer loop ──
  while (true) {
    if (queue.length > 0) {
      const next = queue.shift() as AgentChunk;
      yield next;
      if (next.type === "done") return;
      continue;
    }
    if (finished) return;
    await new Promise<void>((r) => {
      resolveWaiter = r;
    });
  }
}
