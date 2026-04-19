export { startDaemon, readPid, type DaemonHandle, type DaemonOptions } from "./bootstrap.js";
export { loadConfig as loadDaemonConfig, DEFAULT_PORT, PROTOCOL_VERSION, type DaemonConfig } from "./config.js";
export { ensureAuthFile, pairClient, type AuthFile, type PairResult } from "./auth.js";
export { buildHealth, type DaemonHealth } from "./health.js";
