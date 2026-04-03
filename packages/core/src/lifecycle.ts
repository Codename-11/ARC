import { spawn, type ChildProcess } from "node:child_process";
import { writeLogEvent } from "./logging.js";

export interface LifecycleContext {
  component: string;
  profile?: string;
  tool?: string;
}

export interface LifecycleCommandOptions extends LifecycleContext {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface LifecycleCommandResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
}

function normalizeSignalExitCode(signal: NodeJS.Signals | null): number {
  if (!signal) return 1;
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return 1;
}

export async function runCommandWithLifecycle(
  options: LifecycleCommandOptions
): Promise<LifecycleCommandResult> {
  writeLogEvent({
    level: "info",
    component: options.component,
    action: "session:start",
    message: [options.command, ...options.args].join(" "),
    profile: options.profile,
    tool: options.tool,
  });

  return await new Promise<LifecycleCommandResult>((resolve) => {
    let settled = false;
    let childRef: ChildProcess | null = null;
    const listeners = new Map<NodeJS.Signals, () => void>();
    let forwardedSignal: NodeJS.Signals | null = null;

    const cleanup = (): void => {
      for (const [signal, listener] of listeners) {
        process.off(signal, listener);
      }
      listeners.clear();
    };

    const settle = (result: LifecycleCommandResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      writeLogEvent({
        level: result.exitCode === 0 ? "info" : "warn",
        component: options.component,
        action: "session:stop",
        message: result.signal
          ? `terminated by ${result.signal}`
          : `exited with code ${result.exitCode}`,
        profile: options.profile,
        tool: options.tool,
      });
      resolve(result);
    };

    const forwardSignal = (signal: NodeJS.Signals): void => {
      forwardedSignal = signal;
      writeLogEvent({
        level: "warn",
        component: options.component,
        action: "session:signal",
        message: signal,
        profile: options.profile,
        tool: options.tool,
      });
      if (childRef && childRef.pid && !childRef.killed) {
        try {
          childRef.kill(signal);
        } catch {
          // best effort
        }
      }
    };

    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      const listener = () => forwardSignal(signal);
      listeners.set(signal, listener);
      process.on(signal, listener);
    }

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
    });
    childRef = child;

    child.once("error", (error) => {
      writeLogEvent({
        level: "error",
        component: options.component,
        action: "session:error",
        message: error.message,
        profile: options.profile,
        tool: options.tool,
      });
      settle({ exitCode: 1, signal: null });
    });

    child.once("close", (code, signal) => {
      if (forwardedSignal && code === null) {
        settle({
          exitCode: normalizeSignalExitCode(forwardedSignal),
          signal: forwardedSignal,
        });
        return;
      }
      settle({ exitCode: code ?? normalizeSignalExitCode(signal), signal });
    });
  });
}

export async function runManagedCommand(
  options: LifecycleCommandOptions
): Promise<number> {
  const result = await runCommandWithLifecycle(options);
  return result.exitCode;
}

export interface LifecycleScope extends LifecycleContext {
  registerCleanup(cleanup: () => void): void;
  runCleanups(): void;
}

export async function withLifecycleScope<T>(
  context: LifecycleContext,
  run: (scope: LifecycleScope) => Promise<T>
): Promise<T> {
  const cleanups: Array<() => void> = [];
  let cleaned = false;

  const runCleanups = (): void => {
    if (cleaned) return;
    cleaned = true;
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      try {
        cleanup?.();
      } catch {
        // best effort
      }
    }
  };

  const signalListener = (signal: NodeJS.Signals): void => {
    writeLogEvent({
      level: "warn",
      component: context.component,
      action: "scope:signal",
      message: signal,
      profile: context.profile,
      tool: context.tool,
    });
    runCleanups();
  };

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, signalListener);
  }

  try {
    writeLogEvent({
      level: "info",
      component: context.component,
      action: "scope:start",
      profile: context.profile,
      tool: context.tool,
    });
    const result = await run({
      ...context,
      registerCleanup(cleanup) {
        cleanups.push(cleanup);
      },
      runCleanups,
    });
    writeLogEvent({
      level: "info",
      component: context.component,
      action: "scope:stop",
      profile: context.profile,
      tool: context.tool,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeLogEvent({
      level: "error",
      component: context.component,
      action: "scope:error",
      message,
      profile: context.profile,
      tool: context.tool,
    });
    throw error;
  } finally {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.off(signal, signalListener);
    }
    runCleanups();
  }
}

export async function runManagedProcess(options: {
  component: string;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  profile?: string;
  tool?: string;
  beforeSpawn?: () => void | Promise<void>;
}): Promise<LifecycleCommandResult> {
  if (options.beforeSpawn) {
    await options.beforeSpawn();
  }
  return runCommandWithLifecycle(options);
}
