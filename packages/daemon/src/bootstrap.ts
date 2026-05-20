import fs from "node:fs";
import path from "node:path";
import { loadConfig as loadDaemonConfig, type DaemonConfig } from "./config.js";
import { openDb } from "./db.js";
import { createLogger } from "./logger.js";
import { ensureAuthFile } from "./auth.js";
import { Hub } from "./hub.js";
import { AgentRuntime } from "./agent-runtime.js";
import { startServer, type ServerHandle } from "./server.js";

export interface DaemonOptions {
  port?: number;
  host?: string;
  arcDir?: string;
  version?: string;
}

export interface DaemonHandle {
  config: DaemonConfig;
  stop: () => Promise<void>;
}

/** Read running-daemon PID, or null if none/stale. */
export function readPid(pidPath: string): number | null {
  try {
    const raw = fs.readFileSync(pidPath, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    // signal 0 → liveness probe
    try {
      process.kill(pid, 0);
      return pid;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

export async function startDaemon(
  opts: DaemonOptions = {},
): Promise<DaemonHandle & { server: ServerHandle }> {
  const config = loadDaemonConfig({
    ...(opts.port !== undefined ? { port: opts.port } : {}),
    ...(opts.host !== undefined ? { host: opts.host } : {}),
    ...(opts.arcDir !== undefined ? { arcDir: opts.arcDir } : {}),
  });
  fs.mkdirSync(config.arcDir, { recursive: true });

  const existing = readPid(config.pidPath);
  if (existing !== null) {
    throw new Error(`daemon already running (pid ${existing})`);
  }

  const logger = createLogger(config.logPath);
  const db = openDb(config.dbPath);
  const auth = ensureAuthFile(config.authPath);
  const hub = new Hub();
  const version = opts.version ?? readDaemonVersion();
  const startedAt = Date.now();

  const runtime = new AgentRuntime({
    db,
    hub,
    logger,
    broadcastTerminal: (agentId, bytes) => {
      for (const session of hub.subscribers(`agent:${agentId}`)) {
        if (!session.conn.alive) continue;
        session.sendTerminal(agentId, bytes);
      }
    },
  });

  const server = startServer({ config, db, logger, hub, auth, version, startedAt, runtime });
  fs.writeFileSync(config.pidPath, String(process.pid));
  logger.info("daemon.started", { pid: process.pid, version, port: config.port });

  const stop = async () => {
    logger.info("daemon.stopping");
    await runtime.shutdown();
    await server.close();
    try {
      db.close();
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(config.pidPath);
    } catch {
      // ignore
    }
    logger.close();
  };

  installSignalHandlers(stop);

  return { config, server, stop };
}

function installSignalHandlers(stop: () => Promise<void>): void {
  let stopping = false;
  const handler = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await stop();
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
  if (process.platform === "win32") {
    process.once("SIGHUP", handler);
  }
}

function readDaemonVersion(): string {
  try {
    const pkgPath = path.join(
      path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, "")),
      "..",
      "package.json",
    );
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
