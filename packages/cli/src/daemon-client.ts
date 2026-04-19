import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ArcClient } from "@axiom-labs/arc-client";
import {
  DEFAULT_PORT,
  loadDaemonConfig,
  type AuthFile,
} from "@axiom-labs/arc-daemon";

export interface ConnectDaemonOptions {
  host?: string;
  port?: number;
  token?: string;
  /** Disable auto-start if daemon isn't running (useful for tests). */
  noAutoStart?: boolean;
  /** How long to wait for auto-start to come up (ms). */
  startTimeoutMs?: number;
  /** Disable auto-reconnect (default true for CLI one-shots). */
  noReconnect?: boolean;
}

/**
 * Connect to the ARC daemon, auto-starting it if not already running.
 * Reads the shared root token from `~/.arc/auth.json` unless `token` is
 * passed explicitly. The returned client is already authenticated.
 */
export async function connectDaemon(opts: ConnectDaemonOptions = {}): Promise<ArcClient> {
  const cfg = loadDaemonConfig({
    ...(opts.port !== undefined ? { port: opts.port } : {}),
    ...(opts.host !== undefined ? { host: opts.host } : {}),
  });
  const { host, port } = cfg;
  const startTimeoutMs = opts.startTimeoutMs ?? 5000;

  if (!(await probeHealth(host, port, 500))) {
    if (opts.noAutoStart) {
      throw new Error(
        `daemon not running on ${host}:${port}. Start it with \`arc daemon start\`.`,
      );
    }
    autoStartDaemon(port);
    if (!(await waitForHealth(host, port, startTimeoutMs))) {
      throw new Error(
        `could not reach daemon on ${host}:${port} after auto-start. Try \`arc daemon start --foreground\` to inspect startup.`,
      );
    }
  }

  const token = opts.token ?? readAuthToken(cfg.authPath);
  if (!token) {
    throw new Error(
      `no auth token available at ${cfg.authPath}. Start the daemon once to generate one.`,
    );
  }

  const client = new ArcClient({
    url: `ws://${host}:${port}`,
    token,
    noReconnect: opts.noReconnect ?? true,
  });
  try {
    await client.connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to authenticate with daemon: ${message}`);
  }
  return client;
}

function readAuthToken(authPath: string): string | null {
  try {
    const raw = fs.readFileSync(authPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AuthFile>;
    if (typeof parsed?.rootToken === "string" && parsed.rootToken.length > 0) {
      return parsed.rootToken;
    }
  } catch {
    // fall through — token missing or unreadable
  }
  return null;
}

function probeHealth(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { host, port, path: "/health", method: "GET", timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function waitForHealth(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeHealth(host, port, 400)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/**
 * When running under `tsx` (dev), forward `process.execArgv` so the child
 * keeps the TS loader hooks. In production (`dist/index.js`), execArgv is
 * empty and plain node runs the bundled JS.
 */
function autoStartDaemon(port: number): void {
  const entry = process.argv[1];
  if (!entry) return;
  const nodeArgs = [...process.execArgv, entry, "daemon", "start", "--foreground"];
  if (port !== DEFAULT_PORT) nodeArgs.push("--port", String(port));

  try {
    const child = spawn(process.execPath, nodeArgs, {
      detached: true,
      stdio: "ignore",
      env: process.env,
      cwd: path.resolve("."),
      windowsHide: true,
    });
    child.unref();
  } catch {
    // Surface via waitForHealth timeout rather than crashing here.
  }
}

/** True if `err` carries the given RPC error code from the daemon. */
export function hasErrorCode(err: unknown, code: string): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    typeof (err as { code?: unknown }).code === "string" &&
    (err as { code: string }).code === code
  );
}

/**
 * Shared wrapper: connect to the daemon, run `fn(client)`, and always
 * close the client even on error. Errors from `connectDaemon` are printed
 * and converted into exit-code 1.
 */
export async function withDaemonClient(
  fn: (client: ArcClient) => Promise<void>,
): Promise<void> {
  let client: ArcClient;
  try {
    client = await connectDaemon();
  } catch (err) {
    const { error } = await import("./display.js");
    error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  try {
    await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}
