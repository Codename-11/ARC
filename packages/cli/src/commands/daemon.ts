import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadDaemonConfig, readPid, startDaemon } from "@axiom-labs/arc-daemon";
import { VERSION } from "../version.js";
import { info, error, success } from "../display.js";

interface StartOpts {
  port?: string;
  foreground?: boolean;
}

export async function handleDaemonStart(opts: StartOpts): Promise<void> {
  const port = opts.port ? Number.parseInt(opts.port, 10) : undefined;
  const cfg = loadDaemonConfig(port !== undefined ? { port } : {});
  const existing = readPid(cfg.pidPath);
  if (existing !== null) {
    info(`daemon already running (pid ${existing}) on ${cfg.host}:${cfg.port}`);
    return;
  }

  if (opts.foreground) {
    const handle = await startDaemon({
      ...(port !== undefined ? { port } : {}),
      version: VERSION,
    });
    success(`daemon listening on ${handle.config.host}:${handle.config.port}`);
    // Block until a signal triggers stop. `startDaemon` installs SIGINT/SIGTERM
    // handlers that call `process.exit(0)` once shutdown completes.
    await new Promise<void>(() => {});
    return;
  }

  const args = [
    process.argv[1] ?? "",
    "daemon",
    "start",
    "--foreground",
  ];
  if (opts.port) args.push("--port", opts.port);
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  await waitForPid(cfg.pidPath, 5000);
  success(`daemon started on ${cfg.host}:${cfg.port} (log: ${cfg.logPath})`);
}

export async function handleDaemonStop(): Promise<void> {
  const cfg = loadDaemonConfig();
  const pid = readPid(cfg.pidPath);
  if (pid === null) {
    info("daemon not running");
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    error(`failed to signal daemon: ${(err as Error).message}`);
    return;
  }
  for (let i = 0; i < 20; i++) {
    await sleep(100);
    if (readPid(cfg.pidPath) === null) {
      success("daemon stopped");
      return;
    }
  }
  error("daemon did not exit within 2s — may still be shutting down");
}

export async function handleDaemonStatus(opts: { json?: boolean } = {}): Promise<void> {
  const cfg = loadDaemonConfig();
  const pid = readPid(cfg.pidPath);
  const running = pid !== null;
  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ running, pid, host: cfg.host, port: cfg.port, logPath: cfg.logPath }, null, 2) +
        "\n",
    );
    return;
  }
  if (!running) {
    info("daemon: stopped");
    return;
  }
  success(`daemon: running (pid ${pid}) on ${cfg.host}:${cfg.port}`);
}

export async function handleDaemonRestart(opts: StartOpts): Promise<void> {
  await handleDaemonStop();
  await sleep(200);
  await handleDaemonStart(opts);
}

export async function handleDaemonLogs(opts: { tail?: boolean; n?: string } = {}): Promise<void> {
  const cfg = loadDaemonConfig();
  if (!fs.existsSync(cfg.logPath)) {
    info(`no log file at ${cfg.logPath}`);
    return;
  }
  const n = opts.n ? Number.parseInt(opts.n, 10) : 50;
  const content = fs.readFileSync(cfg.logPath, "utf8");
  const lines = content.split("\n").filter(Boolean);
  for (const line of lines.slice(-n)) process.stdout.write(`${line}\n`);
  if (opts.tail) {
    // naive tail: re-read after size grows
    let lastSize = fs.statSync(cfg.logPath).size;
    while (true) {
      await sleep(500);
      const stat = fs.statSync(cfg.logPath);
      if (stat.size > lastSize) {
        const fd = fs.openSync(cfg.logPath, "r");
        const buf = Buffer.alloc(stat.size - lastSize);
        fs.readSync(fd, buf, 0, buf.length, lastSize);
        fs.closeSync(fd);
        process.stdout.write(buf.toString("utf8"));
        lastSize = stat.size;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPid(pidPath: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (readPid(pidPath) !== null) return;
    await sleep(100);
  }
  throw new Error(`daemon did not start within ${timeoutMs}ms`);
}
