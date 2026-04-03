// ---------------------------------------------------------------------------
// Phase 12 — Web Dashboard Types
// ---------------------------------------------------------------------------

import type {
  SessionStore,
  TaskStore,
  SkillRegistry,
  PersistentMemory,
  RemoteAgentRegistry,
  FactoryController,
} from "@axiom-labs/arc-core";

// ---------------------------------------------------------------------------
// Server options
// ---------------------------------------------------------------------------

export interface DashboardOptions {
  /** HTTP port. Default: 3700 */
  port: number;
  /** Bind address. Default: 'localhost' */
  host: string;
  /** Directory for static file serving. */
  publicDir?: string;
  /** CORS Access-Control-Allow-Origin value. Default: '*' (dev-friendly). */
  corsOrigin?: string;
}

// ---------------------------------------------------------------------------
// Injected data-store context
// ---------------------------------------------------------------------------

export interface DashboardContext {
  sessions?: SessionStore;
  tasks?: TaskStore;
  skills?: SkillRegistry;
  memory?: PersistentMemory;
  remoteAgents?: RemoteAgentRegistry;
  factory?: FactoryController;
}

// ---------------------------------------------------------------------------
// Internal router types
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export type RouteHandler = (
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  params: Record<string, string>,
) => void | Promise<void>;

export interface Route {
  method: HttpMethod;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}
