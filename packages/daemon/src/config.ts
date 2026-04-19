import path from "node:path";
import { getArcDir } from "@axiom-labs/arc-core";

export const DEFAULT_PORT = 7272;
export const PROTOCOL_VERSION = 1;

export interface DaemonConfig {
  host: string;
  port: number;
  arcDir: string;
  logPath: string;
  dbPath: string;
  pidPath: string;
  authPath: string;
}

export function loadConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  const arcDir = overrides.arcDir ?? getArcDir();
  const envPort = process.env["ARC_PORT"];
  const port = overrides.port ?? (envPort ? Number.parseInt(envPort, 10) : DEFAULT_PORT);
  return {
    host: overrides.host ?? process.env["ARC_HOST"] ?? "127.0.0.1",
    port,
    arcDir,
    logPath: overrides.logPath ?? path.join(arcDir, "daemon.log"),
    dbPath: overrides.dbPath ?? path.join(arcDir, "arc.db"),
    pidPath: overrides.pidPath ?? path.join(arcDir, "daemon.pid"),
    authPath: overrides.authPath ?? path.join(arcDir, "auth.json"),
  };
}
