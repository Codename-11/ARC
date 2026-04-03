// ---------------------------------------------------------------------------
// Phase 12 — Web Dashboard — Barrel Exports
// ---------------------------------------------------------------------------

export { createDashboardServer } from "./server.js";
export type { DashboardServer } from "./server.js";

export { createApiHandlers } from "./api.js";

export { WebSocketServer, WebSocketClient } from "./ws.js";
export type { ConnectionHandler } from "./ws.js";

export type {
  DashboardOptions,
  DashboardContext,
  HttpMethod,
  RouteHandler,
  Route,
} from "./types.js";
