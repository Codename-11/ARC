import { buildHealth } from "../health.js";
import type { RpcHandler } from "./types.js";

export const healthGet: RpcHandler = (_params, ctx) => {
  return buildHealth(ctx.version, ctx.startedAt, ctx.host, ctx.port);
};
