import type { DB } from "../db.js";
import type { Logger } from "../logger.js";
import type { Session } from "../ws/session.js";
import type { Hub } from "../hub.js";
import type { AuthFile } from "../auth.js";

export interface RpcContext {
  db: DB;
  logger: Logger;
  hub: Hub;
  auth: AuthFile;
  session: Session;
  /** Daemon start time — for uptime reporting. */
  startedAt: number;
  /** Daemon version string. */
  version: string;
  /** Bind host. */
  host: string;
  /** Bind port. */
  port: number;
}

export type RpcHandler = (params: unknown, ctx: RpcContext) => Promise<unknown> | unknown;
