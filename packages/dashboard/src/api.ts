// ---------------------------------------------------------------------------
// Phase 12 — REST API Route Handlers
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  loadConfig,
  saveConfig,
  queryLogEvents,
  type RiskTier,
} from "@axiom-labs/arc-core";
import type { DashboardContext } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum request body size in bytes (1 MB). */
const MAX_BODY_SIZE = 1_048_576;

// ---------------------------------------------------------------------------
// Enum validation sets
// ---------------------------------------------------------------------------

const TASK_STATUSES = ["created", "assigned", "working", "input-required", "completed", "failed", "cancelled"] as const;
const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
const AGENT_TRANSPORTS = ["http", "ssh", "mcp"] as const;
const MEMORY_TYPES = ["fact", "preference", "correction", "pattern", "decision"] as const;

function isValidEnum(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

// ---------------------------------------------------------------------------
// Config lock — prevents concurrent read-modify-write races
// ---------------------------------------------------------------------------

let configLock: Promise<void> = Promise.resolve();

function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = configLock;
  let resolve: () => void;
  configLock = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function errorJson(res: ServerResponse, message: string, status = 400): void {
  json(res, { error: message }, status);
}

function parseQuery(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  return url.searchParams;
}

/**
 * Read and parse a JSON request body.
 * Returns null if the body exceeds MAX_BODY_SIZE or is not valid JSON.
 */
function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          resolve(parsed as Record<string, unknown>);
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    });

    req.on("error", () => {
      resolve(null);
    });
  });
}

// ---------------------------------------------------------------------------
// Risk tier ordering (for distribution aggregation)
// ---------------------------------------------------------------------------

const RISK_TIERS: RiskTier[] = [
  "read-only",
  "file-modification",
  "build-affecting",
  "deploy-affecting",
  "destructive",
];

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export function createApiHandlers(ctx: DashboardContext) {
  return {
    // -------------------------------------------------------------------
    // GET /api/profiles
    // -------------------------------------------------------------------
    profiles(_req: IncomingMessage, res: ServerResponse): void {
      try {
        const config = loadConfig();
        const activeProfile = config.activeProfile ?? "";
        const profiles = config.profiles ?? {};

        const entries = Object.entries(profiles).map(([name, profile]) => ({
          name,
          tool: profile.tool ?? "claude",
          authType: profile.authType ?? "unknown",
          configDir: profile.configDir ?? "",
          description: profile.description ?? "",
          createdAt: profile.createdAt ?? "",
          active: name === activeProfile,
          useShared: profile.useShared ?? false,
          inherits: profile.inherits ?? null,
        }));

        json(res, entries);
      } catch {
        // Config not found or unreadable — return empty array
        json(res, []);
      }
    },

    // -------------------------------------------------------------------
    // POST /api/profiles/:name/switch
    // -------------------------------------------------------------------
    async switchProfile(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
      const name = params["name"];
      if (!name) {
        return errorJson(res, "Profile name is required");
      }

      await withConfigLock(async () => {
        const config = loadConfig();
        if (!config.profiles[name]) {
          return errorJson(res, `Profile '${name}' not found`, 404);
        }

        config.activeProfile = name;
        saveConfig(config);
        json(res, { ok: true, activeProfile: name });
      });
    },

    // -------------------------------------------------------------------
    // DELETE /api/profiles/:name
    // -------------------------------------------------------------------
    async deleteProfile(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
      const name = params["name"];
      if (!name) {
        return errorJson(res, "Profile name is required");
      }

      await withConfigLock(async () => {
        const config = loadConfig();
        if (!config.profiles[name]) {
          return errorJson(res, `Profile '${name}' not found`, 404);
        }

        if (config.activeProfile === name) {
          return errorJson(res, "Cannot delete the active profile", 400);
        }

        delete config.profiles[name];
        saveConfig(config);
        json(res, { ok: true });
      });
    },

    // -------------------------------------------------------------------
    // GET /api/health
    // -------------------------------------------------------------------
    health(_req: IncomingMessage, res: ServerResponse): void {
      json(res, {
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    },

    // -------------------------------------------------------------------
    // GET /api/overview
    // -------------------------------------------------------------------
    overview(_req: IncomingMessage, res: ServerResponse): void {
      const sessions = ctx.sessions?.list() ?? [];
      const activeSessions = sessions.filter((s) => s.status === "active");
      const tasks = ctx.tasks?.list() ?? [];
      const workingTasks = tasks.filter((t) => t.status === "working");
      const skills = ctx.skills?.list() ?? [];
      const agents = ctx.remoteAgents?.list() ?? [];
      const onlineAgents = agents.filter((a) => a.status === "online");
      const factoryState = ctx.factory?.getState() ?? null;

      json(res, {
        profiles: {
          active: activeSessions.length,
          total: sessions.length,
        },
        tasks: {
          working: workingTasks.length,
          total: tasks.length,
        },
        skills: skills.length,
        agents: {
          online: onlineAgents.length,
          total: agents.length,
        },
        factory: factoryState
          ? { status: factoryState.status, currentWave: factoryState.currentWave }
          : null,
        timestamp: new Date().toISOString(),
      });
    },

    // -------------------------------------------------------------------
    // GET /api/sessions?profile=
    // -------------------------------------------------------------------
    sessions(req: IncomingMessage, res: ServerResponse): void {
      if (!ctx.sessions) {
        return json(res, []);
      }

      const qs = parseQuery(req);
      const profile = qs.get("profile") ?? undefined;
      const sessions = ctx.sessions.list({ profile });

      json(res, sessions);
    },

    // -------------------------------------------------------------------
    // GET /api/traces?session=&limit=
    // -------------------------------------------------------------------
    traces(req: IncomingMessage, res: ServerResponse): void {
      const qs = parseQuery(req);
      const limitStr = qs.get("limit");
      const limit = limitStr ? parseInt(limitStr, 10) : 50;
      const sessionFilter = qs.get("session") ?? undefined;

      if (Number.isNaN(limit) || limit < 1) {
        return errorJson(res, "Invalid limit parameter");
      }

      // queryLogEvents does not natively filter by session, but we can
      // post-filter on the data.profile or data.sessionId field.
      let events = queryLogEvents({ limit: limit * 2 });

      if (sessionFilter) {
        events = events.filter(
          (e) =>
            (e.data as Record<string, unknown> | undefined)?.["sessionId"] === sessionFilter,
        );
      }

      json(res, events.slice(0, limit));
    },

    // -------------------------------------------------------------------
    // GET /api/risk/distribution
    // -------------------------------------------------------------------
    riskDistribution(_req: IncomingMessage, res: ServerResponse): void {
      // Aggregate risk tiers from tasks that carry a riskTier field.
      const tasks = ctx.tasks?.list() ?? [];
      const distribution: Record<string, number> = {};

      for (const tier of RISK_TIERS) {
        distribution[tier] = 0;
      }

      for (const task of tasks) {
        const tier = task.riskTier as RiskTier | undefined;
        if (tier && tier in distribution) {
          distribution[tier] += 1;
        }
      }

      json(res, { distribution, total: tasks.length });
    },

    // -------------------------------------------------------------------
    // GET /api/tasks?status=&assignee=
    // -------------------------------------------------------------------
    tasks(req: IncomingMessage, res: ServerResponse): void {
      if (!ctx.tasks) {
        return json(res, []);
      }

      const qs = parseQuery(req);
      const status = qs.get("status") ?? undefined;
      const assignee = qs.get("assignee") ?? undefined;

      const tasks = ctx.tasks.list({
        status: status as import("@axiom-labs/arc-core").TaskStatus | undefined,
        assignee,
      });

      json(res, tasks);
    },

    // -------------------------------------------------------------------
    // POST /api/tasks
    // -------------------------------------------------------------------
    async createTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (!ctx.tasks) {
        return errorJson(res, "Task store not available", 503);
      }

      const body = await parseJsonBody(req);
      if (!body) {
        return errorJson(res, "Invalid or missing JSON body (max 1 MB)", 413);
      }

      const description = body["description"];
      if (typeof description !== "string" || !description.trim()) {
        return errorJson(res, "Field 'description' (string) is required");
      }

      const priority = body["priority"];
      if (priority !== undefined && !isValidEnum(priority, TASK_PRIORITIES)) {
        return errorJson(res, `Invalid priority. Must be one of: ${TASK_PRIORITIES.join(", ")}`);
      }

      const assignee = body["assignee"];
      if (assignee !== undefined && typeof assignee !== "string") {
        return errorJson(res, "Field 'assignee' must be a string");
      }

      const task = ctx.tasks.create(description, {
        assignee: assignee as string | undefined,
        priority: (priority as import("@axiom-labs/arc-core").TaskPriority) ?? undefined,
      });

      ctx.ws?.broadcast("task", { action: "create", task });
      json(res, task, 201);
    },

    // -------------------------------------------------------------------
    // PATCH /api/tasks/:id
    // -------------------------------------------------------------------
    async updateTask(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
      if (!ctx.tasks) {
        return errorJson(res, "Task store not available", 503);
      }

      const id = params["id"];
      const body = await parseJsonBody(req);
      if (!body) {
        return errorJson(res, "Invalid or missing JSON body (max 1 MB)", 413);
      }

      const status = body["status"];
      if (status !== undefined && !isValidEnum(status, TASK_STATUSES)) {
        return errorJson(res, `Invalid status. Must be one of: ${TASK_STATUSES.join(", ")}`);
      }

      const priority = body["priority"];
      if (priority !== undefined && !isValidEnum(priority, TASK_PRIORITIES)) {
        return errorJson(res, `Invalid priority. Must be one of: ${TASK_PRIORITIES.join(", ")}`);
      }

      const fields: Record<string, unknown> = {};
      if (status !== undefined) fields["status"] = status;
      if (priority !== undefined) fields["priority"] = priority;
      if (body["assignee"] !== undefined) fields["assignee"] = body["assignee"];
      if (body["output"] !== undefined) fields["output"] = body["output"];

      const updated = ctx.tasks.update(id, fields);
      if (!updated) {
        return errorJson(res, `Task '${id}' not found`, 404);
      }

      ctx.ws?.broadcast("task", { action: "update", task: updated });
      json(res, updated);
    },

    // -------------------------------------------------------------------
    // POST /api/tasks/:id/cancel
    // -------------------------------------------------------------------
    // NOTE: TaskStore has no hard-delete method. This endpoint cancels a
    // task by setting its status to "cancelled" via stop().
    cancelTask(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void {
      if (!ctx.tasks) {
        return errorJson(res, "Task store not available", 503);
      }

      const id = params["id"];
      const cancelled = ctx.tasks.stop(id);
      if (!cancelled) {
        return errorJson(res, `Task '${id}' not found`, 404);
      }

      ctx.ws?.broadcast("task", { action: "cancel", task: cancelled });
      json(res, cancelled);
    },

    // -------------------------------------------------------------------
    // GET /api/skills
    // -------------------------------------------------------------------
    skills(_req: IncomingMessage, res: ServerResponse): void {
      const skills = ctx.skills?.list() ?? [];
      json(res, skills);
    },

    // -------------------------------------------------------------------
    // GET /api/memory?scope=&type=
    // -------------------------------------------------------------------
    memory(req: IncomingMessage, res: ServerResponse): void {
      if (!ctx.memory) {
        return json(res, []);
      }

      const qs = parseQuery(req);
      const scopeFilter = qs.get("scope") ?? undefined;
      const typeFilter = qs.get("type") ?? undefined;

      let entries = ctx.memory.list();

      if (scopeFilter) {
        entries = entries.filter((e) => e.scope === scopeFilter);
      }
      if (typeFilter) {
        entries = entries.filter((e) => e.type === typeFilter);
      }

      json(res, entries);
    },

    // -------------------------------------------------------------------
    // POST /api/memory
    // -------------------------------------------------------------------
    // The memory entry's scope is determined by the PersistentMemory
    // instance — callers do not provide a scope.
    async addMemory(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (!ctx.memory) {
        return errorJson(res, "Memory store not available", 503);
      }

      const body = await parseJsonBody(req);
      if (!body) {
        return errorJson(res, "Invalid or missing JSON body (max 1 MB)", 413);
      }

      const content = body["content"];
      if (typeof content !== "string" || !content.trim()) {
        return errorJson(res, "Field 'content' (string) is required");
      }

      const type = body["type"];
      if (typeof type !== "string" || !isValidEnum(type, MEMORY_TYPES)) {
        return errorJson(res, `Field 'type' is required and must be one of: ${MEMORY_TYPES.join(", ")}`);
      }

      const tags = body["tags"];
      if (tags !== undefined && !Array.isArray(tags)) {
        return errorJson(res, "Field 'tags' must be an array of strings");
      }

      const entry = ctx.memory.add(content, type as import("@axiom-labs/arc-core").MemoryType, {
        tags: tags as string[] | undefined,
      });

      ctx.ws?.broadcast("memory", { action: "add", entry });
      json(res, entry, 201);
    },

    // -------------------------------------------------------------------
    // GET /api/agents
    // -------------------------------------------------------------------
    agents(_req: IncomingMessage, res: ServerResponse): void {
      const agents = ctx.remoteAgents?.list() ?? [];
      json(res, agents);
    },

    // -------------------------------------------------------------------
    // POST /api/agents
    // -------------------------------------------------------------------
    async addAgent(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (!ctx.remoteAgents) {
        return errorJson(res, "Remote agent registry not available", 503);
      }

      const body = await parseJsonBody(req);
      if (!body) {
        return errorJson(res, "Invalid or missing JSON body (max 1 MB)", 413);
      }

      const name = body["name"];
      if (typeof name !== "string" || !name.trim()) {
        return errorJson(res, "Field 'name' (string) is required");
      }

      const endpoint = body["endpoint"];
      if (typeof endpoint !== "string" || !endpoint.trim()) {
        return errorJson(res, "Field 'endpoint' (string) is required");
      }

      const transport = body["transport"];
      if (typeof transport !== "string" || !isValidEnum(transport, AGENT_TRANSPORTS)) {
        return errorJson(res, `Field 'transport' is required and must be one of: ${AGENT_TRANSPORTS.join(", ")}`);
      }

      const agent = ctx.remoteAgents.register({
        name: name as string,
        endpoint: endpoint as string,
        transport: transport as import("@axiom-labs/arc-core").RemoteAgentTransport,
        status: "unknown",
      });

      ctx.ws?.broadcast("agent", { action: "add", agent });
      json(res, agent, 201);
    },

    // -------------------------------------------------------------------
    // GET /api/factory/:runId
    // -------------------------------------------------------------------
    factory(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void {
      if (!ctx.factory) {
        return errorJson(res, "Factory controller not available", 503);
      }

      const state = ctx.factory.getState();
      if (!state) {
        return errorJson(res, "No factory run loaded", 404);
      }

      // The :runId param is accepted for future multi-run support; for now
      // we return the single active run regardless.
      const _runId = params["runId"];

      json(res, state);
    },

    // -------------------------------------------------------------------
    // GET /api/auth/token — returns the API token (localhost only)
    // -------------------------------------------------------------------
    authToken(_req: IncomingMessage, res: ServerResponse): void {
      // Token is injected by createDashboardServer via closure.
      // This handler is a placeholder — the real implementation is in
      // server.ts where the token is available.
      json(res, { token: null });
    },
  };
}
