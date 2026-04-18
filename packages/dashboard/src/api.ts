// ---------------------------------------------------------------------------
// Phase 12 — REST API Route Handlers
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import {
  loadConfig,
  saveConfig,
  queryLogEvents,
  type RiskTier,
} from "@axiom-labs/arc-core";
import type { DashboardContext } from "./types.js";

// ---------------------------------------------------------------------------
// Chat integration (Phase 7)
// ---------------------------------------------------------------------------
//
// The chat endpoints delegate to several helpers exported by
// `@axiom-labs/arc-core`:
//   - ChatSession / loadSession / saveSession / listSessions / deleteSession
//   - ToolRegistry + registerArcTools + runAgent (agent loop)
//   - getAgentClientForProfile (agent-client dispatch)
//   - buildSystemPrompt (knowledge layer)
//
// These land in core via Phase 4 (chat session store) and Phase 5 (agent
// loop + tool registry). We import them dynamically so the dashboard's
// other routes still compile in environments where the core build hasn't
// yet exposed them — a missing export surfaces as a 503 at chat-time
// rather than a compile-time failure across the whole dashboard.

interface ChatCoreModule {
  ChatSession: {
    new (init: {
      profileName: string;
      permissionMode: import("./types.js").ChatPermissionMode;
    }): ChatSessionInstance;
    load(json: unknown): ChatSessionInstance;
  };
  loadSession: (profile: string, id: string) => ChatSessionInstance;
  saveSession: (session: ChatSessionInstance) => void;
  listSessions: (profile: string) => ChatSessionSummary[];
  deleteSession: (profile: string, id: string) => void;
  ToolRegistry: new () => ToolRegistryInstance;
  registerArcTools: (registry: ToolRegistryInstance) => void;
  runAgent: (
    opts: {
      client: unknown;
      registry: ToolRegistryInstance;
      ctx: {
        mode: import("./types.js").ChatPermissionMode;
        confirm: (prompt: string) => Promise<boolean>;
        log: (msg: string) => void;
      };
    },
    userPrompt: string,
  ) => AsyncIterable<AgentEventLike>;
  getAgentClientForProfile: (profile: string) => unknown;
  buildSystemPrompt: (ctx: Record<string, unknown>) => string;
  loadConfig: () => { profiles: Record<string, unknown>; activeProfile?: string | null };
}

interface ChatSessionInstance {
  id: string;
  profileName: string;
  permissionMode: import("./types.js").ChatPermissionMode;
  messages: Array<{
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    toolCalls?: unknown[];
    toolCallId?: string;
    timestamp: string;
  }>;
  append: (msg: {
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    toolCalls?: unknown[];
    toolCallId?: string;
  }) => unknown;
  summary: () => string;
  serialize: () => unknown;
  updatedAt: string;
  createdAt: string;
}

interface ChatSessionSummary {
  id: string;
  summary: string;
  profileName: string;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
}

interface ToolRegistryInstance {
  execute: (name: string, input: unknown, ctx: unknown) => Promise<unknown>;
  has: (name: string) => boolean;
}

type AgentEventLike =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_call"; id: string; tool: string; input: unknown }
  | { type: "tool_result"; id: string; tool: string; result: unknown }
  | { type: "error"; message: string }
  | { type: "done"; reason: string };

let chatCorePromise: Promise<ChatCoreModule | null> | null = null;
async function loadChatCore(): Promise<ChatCoreModule | null> {
  if (chatCorePromise) return chatCorePromise;
  chatCorePromise = (async () => {
    try {
      const mod = (await import("@axiom-labs/arc-core")) as Record<string, unknown>;
      const required = [
        "ChatSession",
        "loadSession",
        "saveSession",
        "listSessions",
        "deleteSession",
        "ToolRegistry",
        "registerArcTools",
        "runAgent",
        "getAgentClientForProfile",
        "buildSystemPrompt",
      ];
      for (const key of required) {
        if (!(key in mod)) return null;
      }
      return mod as unknown as ChatCoreModule;
    } catch {
      return null;
    }
  })();
  return chatCorePromise;
}

// Confirmation tokens issued to the front-end for supervised write tools.
// Each confirmation promise lives here until the user POSTs /api/chat/confirm.
interface PendingConfirmation {
  resolve: (allow: boolean) => void;
  createdAt: number;
}
const pendingConfirmations = new Map<string, PendingConfirmation>();
const CONFIRMATION_TIMEOUT_MS = 60_000;

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

    // -------------------------------------------------------------------
    // POST /api/chat/message
    // -------------------------------------------------------------------
    //
    // Starts an agent turn for the given profile + chat session. The HTTP
    // response returns `{ chatSessionId }` immediately; streaming chunks
    // flow back over the WebSocket via `broadcastTo(sessionId, ...)`.
    //
    // See docs/plans/ai-and-roundtable.md — Phase 7.
    async chatMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const body = await parseJsonBody(req);
      if (!body) {
        return errorJson(res, "Invalid or missing JSON body (max 1 MB)", 413);
      }

      const sessionId = body["sessionId"];
      const profile = body["profile"];
      const message = body["message"];
      const modeRaw = body["mode"] ?? "supervised";
      const chatSessionIdRaw = body["chatSessionId"];

      if (typeof sessionId !== "string" || !sessionId.trim()) {
        return errorJson(res, "Field 'sessionId' (string) is required");
      }
      if (typeof profile !== "string" || !profile.trim()) {
        return errorJson(res, "Field 'profile' (string) is required");
      }
      if (typeof message !== "string" || !message.trim()) {
        return errorJson(res, "Field 'message' (string) is required");
      }
      if (modeRaw !== "read-only" && modeRaw !== "supervised" && modeRaw !== "autonomous") {
        return errorJson(
          res,
          "Field 'mode' must be one of: read-only, supervised, autonomous",
        );
      }
      const mode = modeRaw;

      const core = await loadChatCore();
      if (!core) {
        return errorJson(
          res,
          "Chat is unavailable: @axiom-labs/arc-core is missing chat/agent/knowledge exports (Phase 4/5 not yet merged)",
          503,
        );
      }

      // Load or create the chat session.
      let session: ChatSessionInstance;
      if (typeof chatSessionIdRaw === "string" && chatSessionIdRaw) {
        try {
          session = core.loadSession(profile, chatSessionIdRaw);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return errorJson(res, `Failed to load session: ${msg}`, 404);
        }
      } else {
        session = new core.ChatSession({ profileName: profile, permissionMode: mode });
      }

      // Append the user message immediately so it shows on reload.
      session.append({ role: "user", content: message });
      try {
        core.saveSession(session);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorJson(res, `Failed to persist session: ${msg}`, 500);
      }

      // Respond right away with the chatSessionId. The rest streams over WS.
      json(res, { chatSessionId: session.id });

      // Fire-and-forget the agent loop. All downstream errors become
      // `chat-error` events so the UI can surface them.
      void runChatTurn(core, ctx, sessionId, session, profile, mode, message).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ws?.broadcastTo(sessionId, "chat-error", { message: msg });
        ctx.ws?.broadcastTo(sessionId, "chat-done", { chatSessionId: session.id });
      });
    },

    // -------------------------------------------------------------------
    // POST /api/chat/confirm
    // -------------------------------------------------------------------
    async chatConfirm(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const body = await parseJsonBody(req);
      if (!body) {
        return errorJson(res, "Invalid or missing JSON body (max 1 MB)", 413);
      }

      const tokenId = body["tokenId"];
      const allow = body["allow"];

      if (typeof tokenId !== "string" || !tokenId) {
        return errorJson(res, "Field 'tokenId' (string) is required");
      }
      if (typeof allow !== "boolean") {
        return errorJson(res, "Field 'allow' (boolean) is required");
      }

      const pending = pendingConfirmations.get(tokenId);
      if (!pending) {
        return errorJson(res, "Unknown or expired tokenId", 404);
      }
      pendingConfirmations.delete(tokenId);
      pending.resolve(allow);
      json(res, { ok: true });
    },

    // -------------------------------------------------------------------
    // GET /api/chat/sessions?profile=<name>
    // -------------------------------------------------------------------
    async chatListSessions(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const profile = parseQuery(req).get("profile");
      if (!profile) {
        return errorJson(res, "Query parameter 'profile' is required");
      }
      const core = await loadChatCore();
      if (!core) {
        return json(res, []);
      }
      try {
        const sessions = core.listSessions(profile);
        json(res, sessions);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorJson(res, `Failed to list sessions: ${msg}`, 500);
      }
    },

    // -------------------------------------------------------------------
    // GET /api/chat/sessions/:id?profile=<name>
    // -------------------------------------------------------------------
    async chatGetSession(
      req: IncomingMessage,
      res: ServerResponse,
      params: Record<string, string>,
    ): Promise<void> {
      const id = params["id"];
      const profile = parseQuery(req).get("profile");
      if (!id) return errorJson(res, "Session id is required");
      if (!profile) return errorJson(res, "Query parameter 'profile' is required");

      const core = await loadChatCore();
      if (!core) {
        return errorJson(res, "Chat is unavailable on this build", 503);
      }
      try {
        const session = core.loadSession(profile, id);
        json(res, session.serialize());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorJson(res, `Failed to load session: ${msg}`, 404);
      }
    },

    // -------------------------------------------------------------------
    // DELETE /api/chat/sessions/:id?profile=<name>
    // -------------------------------------------------------------------
    async chatDeleteSession(
      req: IncomingMessage,
      res: ServerResponse,
      params: Record<string, string>,
    ): Promise<void> {
      const id = params["id"];
      const profile = parseQuery(req).get("profile");
      if (!id) return errorJson(res, "Session id is required");
      if (!profile) return errorJson(res, "Query parameter 'profile' is required");

      const core = await loadChatCore();
      if (!core) {
        return errorJson(res, "Chat is unavailable on this build", 503);
      }
      try {
        core.deleteSession(profile, id);
        json(res, { ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorJson(res, `Failed to delete session: ${msg}`, 500);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Chat turn runner (extracted so `chatMessage` stays concise)
// ---------------------------------------------------------------------------

async function runChatTurn(
  core: ChatCoreModule,
  ctx: DashboardContext,
  wsSessionId: string,
  session: ChatSessionInstance,
  profileName: string,
  mode: import("./types.js").ChatPermissionMode,
  userPrompt: string,
): Promise<void> {
  const ws = ctx.ws;
  if (!ws) {
    throw new Error("Dashboard WebSocket server not available");
  }

  // Resolve agent client + registry.
  let client: unknown;
  try {
    client = core.getAgentClientForProfile(profileName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ws.broadcastTo(wsSessionId, "chat-error", {
      message: `Failed to resolve agent client for profile '${profileName}': ${msg}`,
    });
    ws.broadcastTo(wsSessionId, "chat-done", { chatSessionId: session.id });
    return;
  }

  const registry = new core.ToolRegistry();
  core.registerArcTools(registry);

  // Build system prompt from current ARC state. Best-effort — if knowledge
  // composition fails for any reason, we still attempt the turn with a
  // minimal prompt.
  let systemPrompt = "";
  try {
    const config = core.loadConfig();
    const activeName = config.activeProfile ?? null;
    const profileRecord = activeName ? config.profiles[activeName] : null;
    systemPrompt = core.buildSystemPrompt({
      config,
      recentLaunches: [],
      activeProfile: profileRecord ?? null,
      arcVersion: "dev",
      permissionMode: mode,
      toolCategories: [],
    });
  } catch {
    systemPrompt = "You are the ARC assistant.";
  }

  // The confirmation hook bridges ToolRegistry supervised-mode gating to
  // the dashboard front-end. Each call produces a tokenId, emits
  // `chat-confirm-needed`, and awaits the matching POST /api/chat/confirm.
  const confirm = (prompt: string): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      const tokenId = crypto.randomBytes(16).toString("hex");
      pendingConfirmations.set(tokenId, {
        resolve: (allow: boolean) => {
          clearTimeout(timer);
          resolve(allow);
        },
        createdAt: Date.now(),
      });

      // Auto-deny after the global timeout so the agent loop can't stall
      // indefinitely if the user walks away.
      const timer = setTimeout(() => {
        if (pendingConfirmations.delete(tokenId)) {
          ws.broadcastTo(wsSessionId, "chat-chunk", {
            type: "text",
            content: `[confirmation timed out after ${Math.round(CONFIRMATION_TIMEOUT_MS / 1000)}s — denying]`,
          });
          resolve(false);
        }
      }, CONFIRMATION_TIMEOUT_MS);
      if (timer && typeof timer === "object" && "unref" in timer) {
        (timer as NodeJS.Timeout).unref();
      }

      ws.broadcastTo(wsSessionId, "chat-confirm-needed", {
        tokenId,
        prompt,
      });
    });

  const toolCtx = {
    mode,
    confirm,
    log: (msg: string) => {
      ws.broadcastTo(wsSessionId, "chat-chunk", { type: "log", content: msg });
    },
  };

  // Collect the assistant's turn so we can persist it once done.
  let assistantText = "";
  const toolCalls: Array<{
    id: string;
    name: string;
    input: unknown;
    result?: unknown;
    error?: string;
  }> = [];

  // Prepend systemPrompt to the user message — the v1 AgentClient is
  // one-shot and cannot accept system messages separately. This is a known
  // limitation covered by ai-and-roundtable.md (Phase 4 TODO).
  const combinedPrompt = systemPrompt
    ? `${systemPrompt}\n\n---\n\n${userPrompt}`
    : userPrompt;

  try {
    for await (const event of core.runAgent(
      { client, registry, ctx: toolCtx },
      combinedPrompt,
    )) {
      switch (event.type) {
        case "text":
          assistantText += event.content;
          ws.broadcastTo(wsSessionId, "chat-chunk", {
            type: "text",
            content: event.content,
          });
          break;
        case "thinking":
          ws.broadcastTo(wsSessionId, "chat-chunk", {
            type: "thinking",
            content: event.content,
          });
          break;
        case "tool_call":
          toolCalls.push({ id: event.id, name: event.tool, input: event.input });
          ws.broadcastTo(wsSessionId, "chat-chunk", {
            type: "tool_call",
            id: event.id,
            tool: event.tool,
            input: event.input,
          });
          break;
        case "tool_result": {
          const tc = toolCalls.find((t) => t.id === event.id);
          if (tc) {
            const r = event.result as { ok?: boolean; output?: unknown; error?: string };
            if (r && r.ok === false) {
              tc.error = r.error ?? "tool error";
            } else {
              tc.result = r?.output;
            }
          }
          ws.broadcastTo(wsSessionId, "chat-chunk", {
            type: "tool_result",
            id: event.id,
            tool: event.tool,
            result: event.result,
          });
          break;
        }
        case "error":
          ws.broadcastTo(wsSessionId, "chat-error", { message: event.message });
          break;
        case "done":
          // handled after the loop
          break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ws.broadcastTo(wsSessionId, "chat-error", { message: msg });
  }

  // Persist the assistant turn.
  try {
    session.append({
      role: "assistant",
      content: assistantText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    });
    core.saveSession(session);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ws.broadcastTo(wsSessionId, "chat-error", { message: `persist failed: ${msg}` });
  }

  ws.broadcastTo(wsSessionId, "chat-done", { chatSessionId: session.id });
}
