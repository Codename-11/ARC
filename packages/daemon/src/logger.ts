import fs from "node:fs";
import path from "node:path";

type Level = "debug" | "info" | "warn" | "error";

const ROTATE_BYTES = 50 * 1024 * 1024;

export interface Logger {
  debug: (msg: string, ctx?: Record<string, unknown>) => void;
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  error: (msg: string, ctx?: Record<string, unknown>) => void;
  close: () => void;
}

export function createLogger(logPath: string): Logger {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  rotateIfNeeded(logPath);
  const stream = fs.createWriteStream(logPath, { flags: "a" });
  let closed = false;

  const write = (level: Level, msg: string, ctx?: Record<string, unknown>) => {
    if (closed) return;
    const entry = { ts: new Date().toISOString(), level, msg, ...(ctx ?? {}) };
    stream.write(`${JSON.stringify(entry)}\n`);
  };

  return {
    debug: (m, c) => write("debug", m, c),
    info: (m, c) => write("info", m, c),
    warn: (m, c) => write("warn", m, c),
    error: (m, c) => write("error", m, c),
    close: () => {
      closed = true;
      stream.end();
    },
  };
}

function rotateIfNeeded(logPath: string): void {
  try {
    const stat = fs.statSync(logPath);
    if (stat.size >= ROTATE_BYTES) {
      fs.renameSync(logPath, `${logPath}.1`);
    }
  } catch {
    // file does not exist yet — nothing to rotate
  }
}
