import { PROTOCOL_VERSION } from "./config.js";

export interface DaemonHealth {
  ok: true;
  version: string;
  protocol: number;
  uptime_ms: number;
  pid: number;
  host: string;
  port: number;
}

export function buildHealth(
  version: string,
  startedAt: number,
  host: string,
  port: number,
): DaemonHealth {
  return {
    ok: true,
    version,
    protocol: PROTOCOL_VERSION,
    uptime_ms: Date.now() - startedAt,
    pid: process.pid,
    host,
    port,
  };
}
