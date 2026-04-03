// ---------------------------------------------------------------------------
// Phase 24 — Remote Agent Support
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getArcDir } from "./paths.js";
import { writeLogEvent } from "./logging.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RemoteAgentTransport = "http" | "ssh" | "mcp";
export type RemoteAgentStatus = "online" | "offline" | "unknown";

export interface RemoteAgent {
  id: string;
  name: string;
  endpoint: string; // URL
  transport: RemoteAgentTransport;
  profile?: string;
  status: RemoteAgentStatus;
  lastSeen?: string;
  capabilities?: string[];
}

export interface RemoteAgentConfig {
  agents: RemoteAgent[];
  healthCheckIntervalMs: number; // default: 60000
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function registryPath(): string {
  return path.join(getArcDir(), "remote-agents.json");
}

function readAgents(): RemoteAgent[] {
  try {
    const raw = fs.readFileSync(registryPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RemoteAgent[]) : [];
  } catch {
    return [];
  }
}

function writeAgents(agents: RemoteAgent[]): void {
  const dir = getArcDir();
  fs.mkdirSync(dir, { recursive: true });

  const tempPath = path.join(dir, `remote-agents.tmp.${crypto.randomBytes(4).toString("hex")}`);
  fs.writeFileSync(tempPath, JSON.stringify(agents, null, 2) + "\n", "utf-8");
  fs.renameSync(tempPath, registryPath());
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Check the health of a remote agent by sending an HTTP HEAD request to its
 * endpoint.  Returns 'online' on any 2xx/3xx response, 'offline' otherwise.
 */
export async function checkHealth(agent: RemoteAgent): Promise<"online" | "offline"> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const response = await fetch(agent.endpoint, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok || (response.status >= 300 && response.status < 400)
      ? "online"
      : "offline";
  } catch {
    return "offline";
  }
}

// ---------------------------------------------------------------------------
// RemoteAgentRegistry
// ---------------------------------------------------------------------------

export class RemoteAgentRegistry {
  /** In-memory cache; loaded lazily from disk on first access. */
  private agents: RemoteAgent[] | null = null;

  // ---- Public API ---------------------------------------------------------

  /** Register a new remote agent. */
  register(agent: Omit<RemoteAgent, "id">): RemoteAgent {
    const agents = this.load();
    const entry: RemoteAgent = {
      ...agent,
      id: crypto.randomUUID(),
    };

    agents.push(entry);
    this.persist(agents);

    writeLogEvent({
      level: "info",
      component: "remote",
      action: "register",
      message: `Remote agent '${entry.name}' registered at ${entry.endpoint}`,
      data: { agentId: entry.id, transport: entry.transport },
    });

    return entry;
  }

  /** Remove a remote agent by ID. */
  unregister(id: string): void {
    const agents = this.load();
    const index = agents.findIndex((a) => a.id === id);
    if (index === -1) {
      throw new Error(`Remote agent '${id}' not found`);
    }

    const [removed] = agents.splice(index, 1);
    this.persist(agents);

    writeLogEvent({
      level: "info",
      component: "remote",
      action: "unregister",
      message: `Remote agent '${removed.name}' unregistered`,
      data: { agentId: id },
    });
  }

  /** Return all registered agents. */
  list(): RemoteAgent[] {
    return [...this.load()];
  }

  /** Get a single agent by ID. */
  get(id: string): RemoteAgent | undefined {
    return this.load().find((a) => a.id === id);
  }

  /** Update the status of an agent. */
  updateStatus(id: string, status: RemoteAgentStatus): void {
    const agents = this.load();
    const agent = agents.find((a) => a.id === id);
    if (!agent) {
      throw new Error(`Remote agent '${id}' not found`);
    }

    agent.status = status;
    if (status === "online") {
      agent.lastSeen = new Date().toISOString();
    }

    this.persist(agents);
  }

  /** Return only agents with status 'online'. */
  getOnline(): RemoteAgent[] {
    return this.load().filter((a) => a.status === "online");
  }

  // ---- Internals ----------------------------------------------------------

  private load(): RemoteAgent[] {
    if (this.agents === null) {
      this.agents = readAgents();
    }
    return this.agents;
  }

  private persist(agents: RemoteAgent[]): void {
    this.agents = agents;
    writeAgents(agents);
  }
}
