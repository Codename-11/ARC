// ---------------------------------------------------------------------------
// Phase 12 — REST API Route Handlers
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  loadConfig,
  saveConfig,
  queryLogEvents,
  getRoundtablesDir,
  getPipelinesDir,
  getArcDir,
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
// Daemon token helpers — expose the daemon's root token to browser-side code
// so it can open an authenticated WebSocket through the `/ws` proxy.
// Readable only from localhost to avoid leaking the secret.
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * True iff the HTTP request originated on the loopback interface.
 * Checks both the Host header (server-side mount) and remoteAddress.
 */
export function isLocalRequest(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? "").split(":")[0].toLowerCase();
  if (host && LOOPBACK_HOSTS.has(host)) return true;
  const addr = req.socket.remoteAddress ?? "";
  // Strip IPv6-mapped-IPv4 prefix like `::ffff:127.0.0.1`.
  const normalized = addr.startsWith("::ffff:") ? addr.slice(7) : addr;
  return LOOPBACK_HOSTS.has(normalized);
}

/**
 * Read `~/.arc/auth.json` (written by the daemon on first run) and return
 * the rootToken. Returns null if the file is missing / malformed.
 */
export function readDaemonRootToken(arcDir: string = getArcDir()): string | null {
  try {
    const raw = fs.readFileSync(path.join(arcDir, "auth.json"), "utf8");
    const parsed = JSON.parse(raw) as { rootToken?: unknown; v?: unknown };
    if (parsed.v === 1 && typeof parsed.rootToken === "string" && parsed.rootToken.length >= 16) {
      return parsed.rootToken;
    }
    return null;
  } catch {
    return null;
  }
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
    // GET /api/daemon-token — returns the daemon rootToken (localhost only)
    //
    // Used by the in-browser ArcClient bridge to authenticate the
    // WebSocket it opens through `/ws`. Refuses any non-loopback request
    // to prevent exfiltration of the token via DNS rebinding.
    // -------------------------------------------------------------------
    daemonToken(req: IncomingMessage, res: ServerResponse): void {
      if (!isLocalRequest(req)) {
        return errorJson(res, "Forbidden — daemon token is localhost-only", 403);
      }
      const token = readDaemonRootToken();
      if (!token) {
        return errorJson(
          res,
          "Daemon auth.json not found — is `arc daemon start` running?",
          503,
        );
      }
      json(res, { token });
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

    // -------------------------------------------------------------------
    // POST /api/roundtable/run   (Phase 8)
    // -------------------------------------------------------------------
    async roundtableRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const body = await parseJsonBody(req);
      if (!body) {
        return errorJson(res, "Invalid or missing JSON body (max 1 MB)", 413);
      }

      const topic = body["topic"];
      const agentsRaw = body["agents"];
      const roundsRaw = body["rounds"];
      const synthesizerRaw = body["synthesizer"];

      if (typeof topic !== "string" || !topic.trim()) {
        return errorJson(res, "Field 'topic' (string) is required");
      }
      if (!Array.isArray(agentsRaw) || agentsRaw.length < 2) {
        return errorJson(res, "Field 'agents' must be an array of at least 2 entries");
      }
      const rounds =
        roundsRaw === undefined
          ? undefined
          : typeof roundsRaw === "number" && roundsRaw >= 1 && roundsRaw <= 10
            ? Math.floor(roundsRaw)
            : null;
      if (rounds === null) {
        return errorJson(res, "Field 'rounds' must be a number between 1 and 10");
      }

      const parsedAgents: Array<{ profileName: string; role: string }> = [];
      for (let i = 0; i < agentsRaw.length; i++) {
        const a = agentsRaw[i] as { profileName?: unknown; role?: unknown };
        if (!a || typeof a !== "object") {
          return errorJson(res, `agents[${i}] must be an object`);
        }
        if (typeof a.profileName !== "string" || !a.profileName.trim()) {
          return errorJson(res, `agents[${i}].profileName (string) is required`);
        }
        if (
          typeof a.role !== "string" ||
          !["advocate", "critic", "neutral"].includes(a.role)
        ) {
          return errorJson(
            res,
            `agents[${i}].role must be one of: advocate, critic, neutral`,
          );
        }
        parsedAgents.push({ profileName: a.profileName, role: a.role });
      }

      let synthesizerName: string | undefined;
      if (synthesizerRaw !== undefined) {
        if (typeof synthesizerRaw !== "string" || !synthesizerRaw.trim()) {
          return errorJson(res, "Field 'synthesizer' must be a profile name string");
        }
        synthesizerName = synthesizerRaw;
      }

      // Resolve profiles from config.
      const config = loadConfig();
      const resolvedAgents: Array<{
        profile: Record<string, unknown> & { configDir: string; authType: string; createdAt: string };
        role: "advocate" | "critic" | "neutral";
        displayName: string;
      }> = [];
      for (const a of parsedAgents) {
        const p = config.profiles[a.profileName];
        if (!p) {
          return errorJson(res, `Profile '${a.profileName}' not found`, 404);
        }
        resolvedAgents.push({
          profile: p as unknown as Record<string, unknown> & {
            configDir: string;
            authType: string;
            createdAt: string;
          },
          role: a.role as "advocate" | "critic" | "neutral",
          displayName: a.profileName,
        });
      }

      const synthesizerAgent = synthesizerName
        ? resolvedAgents.find((r) => r.displayName === synthesizerName)
        : undefined;
      if (synthesizerName && !synthesizerAgent) {
        return errorJson(
          res,
          `Synthesizer profile '${synthesizerName}' is not in the agents list`,
        );
      }

      // Dynamically load the orchestrator so tests can mock
      // @axiom-labs/arc-core and unit tests for other endpoints don't pay the
      // cost of instantiating it.
      let Orchestrator: unknown;
      try {
        const mod = (await import("@axiom-labs/arc-core")) as Record<string, unknown>;
        Orchestrator = mod["RoundtableOrchestrator"];
      } catch {
        /* ignore */
      }
      if (typeof Orchestrator !== "function") {
        return errorJson(
          res,
          "RoundtableOrchestrator unavailable — rebuild @axiom-labs/arc-core",
          503,
        );
      }

      const roundtableId = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      // Respond immediately. Orchestration runs in the background and
      // broadcasts progress via WebSocket.
      json(res, { roundtableId });

      const ws = ctx.ws;
      void (async (): Promise<void> => {
        try {
          const OrchCtor = Orchestrator as new (opts?: unknown) => {
            run(opts: {
              topic: string;
              agents: Array<{
                profile: unknown;
                role: string;
                displayName?: string;
              }>;
              rounds?: number;
              synthesizer?: { profile: unknown; role: string; displayName?: string };
              onEvent?: (evt: Record<string, unknown>) => void;
            }): Promise<unknown>;
          };
          const orchestrator = new OrchCtor();
          const result = await orchestrator.run({
            topic,
            agents: resolvedAgents.map((a) => ({
              profile: a.profile,
              role: a.role,
              displayName: a.displayName,
            })),
            rounds,
            synthesizer: synthesizerAgent
              ? {
                  profile: synthesizerAgent.profile,
                  role: synthesizerAgent.role,
                  displayName: synthesizerAgent.displayName,
                }
              : undefined,
            onEvent: (event) => {
              ws?.broadcast("roundtable-event", { roundtableId, event });
            },
          });

          const summary = {
            id: roundtableId,
            topic,
            agents: parsedAgents,
            rounds,
            createdAt,
            result,
          };
          persistOrchestrationRecord(getRoundtablesDir(), roundtableId, summary);
          ws?.broadcast("roundtable-event", {
            roundtableId,
            event: { type: "persisted", id: roundtableId },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ws?.broadcast("roundtable-error", { roundtableId, error: msg });
        }
      })();
    },

    // -------------------------------------------------------------------
    // GET /api/roundtable/history   (Phase 8)
    // -------------------------------------------------------------------
    roundtableHistory(_req: IncomingMessage, res: ServerResponse): void {
      const entries = listOrchestrationSummaries(getRoundtablesDir(), (raw) => {
        const result = (raw["result"] as { consensusScore?: unknown } | undefined) ?? undefined;
        const consensusScore =
          result && typeof result.consensusScore === "number"
            ? result.consensusScore
            : undefined;
        return {
          id: raw["id"],
          topic: raw["topic"],
          agents: raw["agents"],
          createdAt: raw["createdAt"],
          consensusScore,
        };
      });
      json(res, entries);
    },

    // -------------------------------------------------------------------
    // GET /api/roundtable/:id   (Phase 8)
    // -------------------------------------------------------------------
    roundtableGet(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void {
      const id = params["id"];
      if (!isUuid(id)) {
        return errorJson(res, "Invalid roundtable id", 400);
      }
      const record = readOrchestrationRecord(getRoundtablesDir(), id);
      if (!record) {
        return errorJson(res, `Roundtable '${id}' not found`, 404);
      }
      json(res, record);
    },

    // -------------------------------------------------------------------
    // POST /api/pipeline/run   (Phase 8)
    // -------------------------------------------------------------------
    async pipelineRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const body = await parseJsonBody(req);
      if (!body) {
        return errorJson(res, "Invalid or missing JSON body (max 1 MB)", 413);
      }

      const phasesRaw = body["phases"];
      const phaseTimeoutMsRaw = body["phaseTimeoutMs"];
      const agentsRaw = body["agents"];

      if (!Array.isArray(agentsRaw) || agentsRaw.length === 0) {
        return errorJson(res, "Field 'agents' must be a non-empty array");
      }

      const allowedPhases = ["plan", "exec", "verify"] as const;
      let phases: ("plan" | "exec" | "verify")[] | undefined;
      if (phasesRaw !== undefined) {
        if (!Array.isArray(phasesRaw) || phasesRaw.length === 0) {
          return errorJson(res, "Field 'phases' must be a non-empty array when provided");
        }
        for (const p of phasesRaw) {
          if (typeof p !== "string" || !allowedPhases.includes(p as "plan")) {
            return errorJson(
              res,
              `Each 'phases' entry must be one of: ${allowedPhases.join(", ")}`,
            );
          }
        }
        phases = phasesRaw as ("plan" | "exec" | "verify")[];
      }

      let phaseTimeoutMs: Partial<Record<"plan" | "exec" | "verify", number>> | undefined;
      if (phaseTimeoutMsRaw !== undefined) {
        if (typeof phaseTimeoutMsRaw !== "object" || phaseTimeoutMsRaw === null) {
          return errorJson(res, "Field 'phaseTimeoutMs' must be an object");
        }
        phaseTimeoutMs = {};
        for (const [k, v] of Object.entries(phaseTimeoutMsRaw as Record<string, unknown>)) {
          if (!allowedPhases.includes(k as "plan")) continue;
          if (typeof v !== "number" || v <= 0) {
            return errorJson(res, `phaseTimeoutMs.${k} must be a positive number`);
          }
          phaseTimeoutMs[k as "plan" | "exec" | "verify"] = v;
        }
      }

      const parsedAgents: Array<{ profileName: string }> = [];
      for (let i = 0; i < agentsRaw.length; i++) {
        const a = agentsRaw[i] as { profileName?: unknown };
        if (!a || typeof a !== "object" || typeof a.profileName !== "string" || !a.profileName.trim()) {
          return errorJson(res, `agents[${i}].profileName (string) is required`);
        }
        parsedAgents.push({ profileName: a.profileName });
      }

      let coreMod: Record<string, unknown> | null = null;
      try {
        coreMod = (await import("@axiom-labs/arc-core")) as Record<string, unknown>;
      } catch {
        /* fall through */
      }
      const StagedWorkflowManager = coreMod?.["StagedWorkflowManager"];
      const InMemoryMessageBus = coreMod?.["InMemoryMessageBus"];
      if (typeof StagedWorkflowManager !== "function" || typeof InMemoryMessageBus !== "function") {
        return errorJson(
          res,
          "StagedWorkflowManager unavailable — rebuild @axiom-labs/arc-core",
          503,
        );
      }

      const pipelineId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      json(res, { pipelineId });

      const ws = ctx.ws;
      void (async (): Promise<void> => {
        try {
          const BusCtor = InMemoryMessageBus as new () => unknown;
          const bus = new BusCtor();
          const ManagerCtor = StagedWorkflowManager as new (
            config: unknown,
            deps: unknown,
          ) => {
            run(): Promise<unknown>;
          };

          const phaseStartAt: Partial<Record<"plan" | "exec" | "verify", number>> = {};
          const manager = new ManagerCtor(
            {
              phases,
              phaseTimeoutMs,
              onPhaseChange: (phase: string) => {
                const now = Date.now();
                let durationMs: number | undefined;
                if (phase === "complete" || phase === "aborted") {
                  // Use the last observed phase entry time if possible.
                  const lastEntry = Object.entries(phaseStartAt).pop();
                  if (lastEntry) durationMs = now - (lastEntry[1] as number);
                } else if (phase === "plan" || phase === "exec" || phase === "verify") {
                  phaseStartAt[phase] = now;
                }
                ws?.broadcast("pipeline-event", {
                  pipelineId,
                  phase,
                  durationMs,
                });
              },
            },
            {
              messageBus: bus,
              allAgents: parsedAgents.map((a) => a.profileName),
            },
          );

          const result = await manager.run();

          const summary = {
            id: pipelineId,
            phases: phases ?? ["plan", "exec", "verify"],
            agents: parsedAgents,
            createdAt,
            result,
          };
          persistOrchestrationRecord(getPipelinesDir(), pipelineId, summary);
          ws?.broadcast("pipeline-event", {
            pipelineId,
            phase: "persisted",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ws?.broadcast("pipeline-error", { pipelineId, error: msg });
        }
      })();
    },

    // -------------------------------------------------------------------
    // GET /api/pipeline/history   (Phase 8)
    // -------------------------------------------------------------------
    pipelineHistory(_req: IncomingMessage, res: ServerResponse): void {
      const entries = listOrchestrationSummaries(getPipelinesDir(), (raw) => ({
        id: raw["id"],
        phases: raw["phases"],
        agents: raw["agents"],
        createdAt: raw["createdAt"],
      }));
      json(res, entries);
    },

    // -------------------------------------------------------------------
    // GET /api/pipeline/:id   (Phase 8)
    // -------------------------------------------------------------------
    pipelineGet(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void {
      const id = params["id"];
      if (!isUuid(id)) {
        return errorJson(res, "Invalid pipeline id", 400);
      }
      const record = readOrchestrationRecord(getPipelinesDir(), id);
      if (!record) {
        return errorJson(res, `Pipeline '${id}' not found`, 404);
      }
      json(res, record);
    },
  };
}

// ---------------------------------------------------------------------------
// Orchestration persistence helpers (Phase 8)
// ---------------------------------------------------------------------------

/**
 * Strict UUID (v1-v5) validator. Restricting to hyphen-separated UUIDs keeps
 * the filesystem-visible id safe: no traversal, no path separators, bounded
 * length. Anything routed through `/api/roundtable/:id` or `/api/pipeline/:id`
 * must match.
 */
function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/** Atomic write: write to temp file, rename into place. */
function persistOrchestrationRecord(
  dir: string,
  id: string,
  record: Record<string, unknown>,
): void {
  if (!isUuid(id)) {
    throw new Error(`Refusing to persist with non-UUID id: ${id}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const final = path.join(dir, `${id}.json`);
  const tmp = `${final}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), "utf-8");
  fs.renameSync(tmp, final);
}

function readOrchestrationRecord(
  dir: string,
  id: string,
): Record<string, unknown> | null {
  if (!isUuid(id)) return null;
  const file = path.join(dir, `${id}.json`);
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function listOrchestrationSummaries<T extends { createdAt?: unknown }>(
  dir: string,
  project: (raw: Record<string, unknown>) => T,
): T[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const entries: T[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    if (!isUuid(id)) continue;
    const record = readOrchestrationRecord(dir, id);
    if (!record) continue;
    entries.push(project(record));
  }
  entries.sort((a, b) => {
    const av = typeof a.createdAt === "string" ? a.createdAt : "";
    const bv = typeof b.createdAt === "string" ? b.createdAt : "";
    if (av < bv) return 1;
    if (av > bv) return -1;
    return 0;
  });
  return entries;
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
