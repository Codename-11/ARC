/**
 * Shared cross-platform process management.
 *
 * Provides spawn, terminate, health-check, and JSONL parsing for all adapters.
 * Windows uses `taskkill /T /F /PID` for tree termination.
 * POSIX uses negative-PID SIGTERM with SIGKILL fallback for process-group termination.
 */

import { spawn, execSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import { writeLogEvent } from "./logging.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface SpawnManagedProcessOptions {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Component label for structured logging (e.g. "codex", "generic"). */
  component?: string;
}

export interface ManagedProcessHandle {
  pid: number;
  child: ChildProcess;
}

export interface ParsedJsonlLine {
  type: string;
  content: string;
  raw: string;
}

// ─── Constants ───────────────────────────────────────────────────────

const IS_WINDOWS = process.platform === "win32";
const TERMINATE_SIGKILL_TIMEOUT_MS = 5_000;

// ─── Spawn ───────────────────────────────────────────────────────────

/**
 * Spawn a managed child process. On POSIX, uses `detached: true` to create a
 * process group. On Windows, spawns via shell to get a new process group.
 * Returns a handle with the real PID and the ChildProcess reference.
 */
export function spawnManagedProcess(opts: SpawnManagedProcessOptions): ManagedProcessHandle {
  const spawnOpts: SpawnOptions = {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
    // POSIX: detached creates a new process group (kill with -pid)
    // Windows: shell mode gives us a process tree that taskkill /T can reach
    detached: !IS_WINDOWS,
    shell: IS_WINDOWS,
    windowsHide: true,
  };

  const child = spawn(opts.command, opts.args, spawnOpts);

  // Attach error handler immediately to prevent uncaught exceptions from
  // spawn failures (e.g., ENOENT when the binary doesn't exist on PATH).
  child.on("error", (err) => {
    writeLogEvent({
      level: "error",
      component: opts.component ?? "process",
      action: "process:spawn:error",
      message: `spawn error for ${opts.command}: ${err.message}`,
      data: { command: opts.command, error: err.message },
    });
  });

  if (!child.pid) {
    throw new Error(`Failed to spawn process: ${opts.command} ${opts.args.join(" ")}`);
  }

  writeLogEvent({
    level: "info",
    component: opts.component ?? "process",
    action: "process:spawn",
    message: `pid=${child.pid} cmd=${opts.command} args=${JSON.stringify(opts.args)}`,
    data: { pid: child.pid, command: opts.command, args: opts.args },
  });

  // Unref on POSIX so the child doesn't keep the parent alive if parent exits
  if (!IS_WINDOWS) {
    child.unref();
  }

  return { pid: child.pid, child };
}

// ─── Terminate ───────────────────────────────────────────────────────

/**
 * Terminate a process by PID. Cross-platform:
 * - Windows: `taskkill /T /F /PID <pid>` (kills entire process tree)
 * - POSIX: `kill(-pid, SIGTERM)` (signal entire process group), then SIGKILL fallback
 *
 * Returns a promise that resolves when the process is confirmed dead
 * or the kill attempt has been made.
 */
export async function terminateProcess(pid: number, component?: string): Promise<void> {
  const logComponent = component ?? "process";

  writeLogEvent({
    level: "info",
    component: logComponent,
    action: "process:terminate",
    message: `terminating pid=${pid} platform=${process.platform}`,
    data: { pid },
  });

  if (IS_WINDOWS) {
    try {
      execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore", timeout: 10_000 });
    } catch {
      // Process may already be dead — that's fine.
    }
    return;
  }

  // POSIX: send SIGTERM to the process group (negative PID)
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // ESRCH = process already gone, which is fine
    return;
  }

  // Wait for the process to die, then SIGKILL if it's still alive
  const deadline = Date.now() + TERMINATE_SIGKILL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return;
    }
    await sleep(200);
  }

  // Still alive after timeout — escalate to SIGKILL
  try {
    process.kill(-pid, "SIGKILL");
    writeLogEvent({
      level: "warn",
      component: logComponent,
      action: "process:terminate",
      message: `escalated to SIGKILL for pid=${pid}`,
      data: { pid },
    });
  } catch {
    // Already dead.
  }
}

// ─── Health check ────────────────────────────────────────────────────

/**
 * Check whether a process is still running. Cross-platform, never throws.
 * Uses `process.kill(pid, 0)` which sends no signal but checks existence.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── JSONL parsing ───────────────────────────────────────────────────

/**
 * Parse a single line as JSONL. If the line is valid JSON with a `type` field,
 * returns a structured object. Otherwise returns a raw event.
 */
export function parseJsonlLine(line: string): ParsedJsonlLine {
  const trimmed = line.trim();
  if (!trimmed) {
    return { type: "raw", content: "", raw: line };
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed === "object" && parsed !== null && typeof parsed["type"] === "string") {
      return {
        type: parsed["type"],
        content: typeof parsed["content"] === "string"
          ? parsed["content"]
          : typeof parsed["message"] === "string"
            ? parsed["message"]
            : JSON.stringify(parsed),
        raw: line,
      };
    }
    // Valid JSON but no type field — treat as raw with the JSON stringified
    return { type: "raw", content: trimmed, raw: line };
  } catch {
    // Not valid JSON — emit as raw
    return { type: "raw", content: trimmed, raw: line };
  }
}

// ─── Wait for exit ───────────────────────────────────────────────────

/**
 * Wait for a process to exit by polling `isProcessRunning`.
 * Resolves when the process is no longer running.
 * Used by CLI `handleLaunch` to block until the adapter-launched child exits.
 */
export async function waitForProcessExit(
  pid: number,
  pollIntervalMs = 250
): Promise<void> {
  while (isProcessRunning(pid)) {
    await sleep(pollIntervalMs);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
