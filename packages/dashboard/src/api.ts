// ---------------------------------------------------------------------------
// Phase 12 — REST API Route Handlers
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  queryLogEvents,
  type RiskTier,
} from "@axiom-labs/arc-core";
import type { DashboardContext } from "./types.js";

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
        const arcDir = process.env["ARC_DIR"] ?? join(homedir(), ".arc");
        const configPath = join(arcDir, "config.json");
        const raw = readFileSync(configPath, "utf-8");
        const config = JSON.parse(raw) as {
          activeProfile?: string;
          profiles?: Record<string, Record<string, unknown>>;
        };

        const activeProfile = config.activeProfile ?? "";
        const profiles = config.profiles ?? {};

        const entries = Object.entries(profiles).map(([name, profile]) => ({
          name,
          tool: (profile["tool"] as string) ?? "claude",
          authType: (profile["authType"] as string) ?? "unknown",
          configDir: (profile["configDir"] as string) ?? "",
          description: (profile["description"] as string) ?? "",
          createdAt: (profile["createdAt"] as string) ?? "",
          active: name === activeProfile,
          useShared: (profile["useShared"] as boolean) ?? false,
          inherits: (profile["inherits"] as string) ?? null,
        }));

        json(res, entries);
      } catch {
        // Config not found or unreadable — return empty array
        json(res, []);
      }
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
    // GET /api/agents
    // -------------------------------------------------------------------
    agents(_req: IncomingMessage, res: ServerResponse): void {
      const agents = ctx.remoteAgents?.list() ?? [];
      json(res, agents);
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
  };
}
