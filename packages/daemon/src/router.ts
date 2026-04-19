import { ErrorCode, type Envelope } from "@axiom-labs/arc-client";
import { PUBLIC_METHODS, handlers } from "./rpc/index.js";
import type { RpcContext } from "./rpc/types.js";
import type { Session } from "./ws/session.js";

export async function dispatchEnvelope(
  session: Session,
  envelope: Envelope,
  baseCtx: Omit<RpcContext, "session">,
): Promise<void> {
  const ctx: RpcContext = { ...baseCtx, session };

  switch (envelope.type) {
    case "request":
      await handleRequest(session, envelope, ctx);
      return;
    case "subscribe":
      handleSubscribe(session, envelope, ctx);
      return;
    case "unsubscribe":
      handleUnsubscribe(session, envelope, ctx);
      return;
    default:
      // Clients don't send response/event/error to the server. Ignore cleanly.
      return;
  }
}

async function handleRequest(session: Session, envelope: Envelope, ctx: RpcContext): Promise<void> {
  const method = envelope.method;
  if (!method) {
    replyError(session, envelope.id, ErrorCode.BadRequest, "missing method");
    return;
  }
  const handler = handlers[method];
  if (!handler) {
    replyError(session, envelope.id, ErrorCode.Unimplemented, `unknown method: ${method}`);
    return;
  }
  if (!session.authenticated && !PUBLIC_METHODS.has(method)) {
    replyError(session, envelope.id, ErrorCode.Unauthorized, "authenticate first");
    return;
  }
  try {
    const result = await handler(envelope.params, ctx);
    session.sendControl({
      v: 1,
      id: envelope.id,
      type: "response",
      result,
    });
  } catch (err: unknown) {
    const { code, message } = normalizeError(err);
    replyError(session, envelope.id, code, message);
    ctx.logger.warn("rpc.error", { method, code, message });
  }
}

function handleSubscribe(session: Session, envelope: Envelope, ctx: RpcContext): void {
  if (!session.authenticated) {
    replyError(session, envelope.id, ErrorCode.Unauthorized, "authenticate first");
    return;
  }
  const topic = envelope.topic;
  if (!topic) {
    replyError(session, envelope.id, ErrorCode.BadRequest, "missing topic");
    return;
  }
  ctx.hub.subscribe(session, topic);
  session.sendControl({ v: 1, id: envelope.id, type: "response", result: { ok: true, topic } });
}

function handleUnsubscribe(session: Session, envelope: Envelope, ctx: RpcContext): void {
  const topic = envelope.topic;
  if (!topic) return;
  ctx.hub.unsubscribe(session, topic);
  session.sendControl({ v: 1, id: envelope.id, type: "response", result: { ok: true, topic } });
}

function replyError(session: Session, id: string, code: string, message: string): void {
  session.sendControl({ v: 1, id, type: "error", code, message });
}

function normalizeError(err: unknown): { code: string; message: string } {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    return { code: String((err as { code: unknown }).code), message: String((err as { message: unknown }).message) };
  }
  if (err instanceof Error) return { code: ErrorCode.Internal, message: err.message };
  return { code: ErrorCode.Internal, message: String(err) };
}
