import { AuthLoginParams, type AuthLoginResult } from "@axiom-labs/arc-client";
import { verifyToken } from "../auth.js";
import type { RpcHandler } from "./types.js";

export const authLogin: RpcHandler = (raw, ctx) => {
  const { token } = AuthLoginParams.parse(raw);
  const who = verifyToken(ctx.db, ctx.auth.rootToken, token);
  if (!who) {
    const err = new Error("invalid token") as Error & { code: string };
    err.code = "unauthorized";
    throw err;
  }
  ctx.session.authenticated = true;
  ctx.session.clientId = who.clientId;
  ctx.session.clientLabel = who.label;
  ctx.logger.info("session.authenticated", {
    sessionId: ctx.session.id,
    clientId: who.clientId,
    label: who.label,
  });
  const result: typeof AuthLoginResult._type = {
    sessionId: ctx.session.id,
    clientId: who.clientId,
    serverVersion: ctx.version,
    protocol: 1,
  };
  return result;
};
