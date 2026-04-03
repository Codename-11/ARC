import path from "node:path";
import type { Command } from "commander";
import { loadConfig, readJsonObject, resolveEffectiveProfile } from "../config.js";
import type { McpServerConfig } from "@axiom-labs/arc-mcp";
import { McpHostManager } from "@axiom-labs/arc-mcp";

// ─── Module-level host manager (shared across connect/list/disconnect) ──

let hostManager: McpHostManager | null = null;

function getOrCreateHost(): McpHostManager {
  if (!hostManager) {
    hostManager = new McpHostManager();
  }
  return hostManager;
}

// ─── Read mcpServers from the active profile's settings.json ─────────

function loadProfileMcpServers(): Record<string, McpServerConfig> {
  const config = loadConfig();

  // Resolve profile through workspace-aware pipeline (arc.json overrides)
  let profile;
  try {
    const result = resolveEffectiveProfile(config);
    profile = result.profile;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[arc-mcp] ${msg}`);
    process.exit(1);
  }

  // Read mcpServers from the resolved profile's settings.json
  const settingsPath = path.join(profile.configDir, "settings.json");
  const settings = readJsonObject(settingsPath);

  let servers: Record<string, McpServerConfig> = {};
  if (settings && settings.mcpServers) {
    const raw = settings.mcpServers;
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      servers = raw as Record<string, McpServerConfig>;
    }
  }

  // Merge workspace-level mcpServers from arc.json (already on profile via applyWorkspaceOverrides)
  const workspaceMcpServers = (profile as unknown as Record<string, unknown>)["mcpServers"];
  if (
    workspaceMcpServers &&
    typeof workspaceMcpServers === "object" &&
    !Array.isArray(workspaceMcpServers)
  ) {
    servers = { ...servers, ...workspaceMcpServers as Record<string, McpServerConfig> };
  }

  return servers;
}

// ─── Command registration ────────────────────────────────────────────

/**
 * Register the `arc mcp` command group with serve, connect, list, and
 * disconnect subcommands.
 *
 * `arc mcp serve`      — Start the MCP supervision server.
 * `arc mcp connect`    — Connect to external MCP servers from profile config.
 * `arc mcp list`       — List connected MCP servers and their tools.
 * `arc mcp disconnect` — Disconnect from external MCP servers.
 */
export function registerMcpCommand(program: Command): void {
  const mcp = program
    .command("mcp")
    .description("MCP supervision server and external server management");

  // ── serve ────────────────────────────────────────────────────────

  mcp
    .command("serve")
    .description("Start the ARC MCP supervision server")
    .option("--transport <type>", "Transport type: stdio or http", "stdio")
    .option("--port <number>", "HTTP port (only with --transport http)", "3100")
    .option("--auth-token <token>", "Bearer auth token (only with --transport http)")
    .option("--require-auth", "Require auth even for localhost (only with --transport http)", false)
    .action(async (opts: {
      transport: string;
      port: string;
      authToken?: string;
      requireAuth: boolean;
    }) => {
      const transport = opts.transport;

      if (transport !== "stdio" && transport !== "http") {
        console.error(`[arc-mcp] Unsupported transport: "${transport}". Use "stdio" or "http".`);
        process.exit(1);
      }

      if (transport === "stdio") {
        if (opts.authToken !== undefined) {
          console.error("[arc-mcp] --auth-token is only valid with --transport http");
          process.exit(1);
        }
        if (opts.requireAuth) {
          console.error("[arc-mcp] --require-auth is only valid with --transport http");
          process.exit(1);
        }

        const { startStdioServer } = await import("@axiom-labs/arc-mcp");
        await startStdioServer();
        return;
      }

      // --- HTTP transport ---
      const port = Number(opts.port);
      if (!Number.isFinite(port) || port < 0 || port > 65535) {
        console.error(`[arc-mcp] Invalid port: "${opts.port}". Must be a number between 0 and 65535.`);
        process.exit(1);
      }

      const { startHttpServer } = await import("@axiom-labs/arc-mcp");
      await startHttpServer({
        port,
        authToken: opts.authToken,
        requireAuth: opts.requireAuth,
      });
    });

  // ── connect ──────────────────────────────────────────────────────

  mcp
    .command("connect [name]")
    .description("Connect to external MCP server(s) from profile config")
    .action(async (name?: string) => {
      const mcpServers = loadProfileMcpServers();
      const serverNames = Object.keys(mcpServers);

      if (serverNames.length === 0) {
        console.error(
          "[arc-mcp] No mcpServers configured in the active profile's settings.json.",
        );
        process.exit(1);
      }

      const host = getOrCreateHost();

      if (name) {
        // Connect to a specific server
        const config = mcpServers[name];
        if (!config) {
          console.error(
            `[arc-mcp] Server "${name}" not found in profile config. Available: ${serverNames.join(", ")}`,
          );
          process.exit(1);
        }

        await host.connect(name, config);
        const entry = host.listConnected().find((s) => s.name === name);
        if (entry?.status === "error") {
          console.error(`[arc-mcp] Failed to connect to "${name}": ${entry.error}`);
          process.exit(1);
        }
        console.log(`Connected to "${name}" — ${entry?.tools.length ?? 0} tool(s) discovered.`);
        return;
      }

      // Connect to all configured servers
      let failures = 0;
      for (const [serverName, config] of Object.entries(mcpServers)) {
        await host.connect(serverName, config);
        const entry = host.listConnected().find((s) => s.name === serverName);
        if (entry?.status === "error") {
          console.error(`[arc-mcp] Failed to connect to "${serverName}": ${entry.error}`);
          failures++;
        } else {
          console.log(
            `Connected to "${serverName}" — ${entry?.tools.length ?? 0} tool(s) discovered.`,
          );
        }
      }

      if (failures > 0 && failures === serverNames.length) {
        process.exit(1);
      }
    });

  // ── list ─────────────────────────────────────────────────────────

  mcp
    .command("list")
    .description("List connected external MCP servers and their tools")
    .action(() => {
      const host = hostManager;
      if (!host) {
        console.log("No connected MCP servers.");
        return;
      }

      const servers = host.listConnected();
      if (servers.length === 0) {
        console.log("No connected MCP servers.");
        return;
      }

      for (const srv of servers) {
        const toolNames = srv.tools.map((t) => t.name).join(", ");
        const toolLabel = srv.tools.length === 1 ? "tool" : "tools";

        if (srv.status === "error") {
          console.log(`  ${srv.name}  [${srv.status}]  ${srv.error ?? "unknown error"}`);
        } else {
          console.log(
            `  ${srv.name}  [${srv.status}]  ${srv.tools.length} ${toolLabel}${toolNames ? `: ${toolNames}` : ""}`,
          );
        }
      }
    });

  // ── disconnect ───────────────────────────────────────────────────

  mcp
    .command("disconnect [name]")
    .description("Disconnect from external MCP server(s)")
    .action(async (name?: string) => {
      const host = hostManager;
      if (!host) {
        console.log("No connected MCP servers to disconnect.");
        return;
      }

      if (name) {
        const entry = host.listConnected().find((s) => s.name === name);
        if (!entry) {
          console.error(
            `[arc-mcp] Server "${name}" is not connected. Connected: ${host.listConnected().map((s) => s.name).join(", ") || "none"}`,
          );
          process.exit(1);
        }
        await host.disconnect(name);
        console.log(`Disconnected from "${name}".`);
        return;
      }

      // Disconnect all
      const names = host.listConnected().map((s) => s.name);
      if (names.length === 0) {
        console.log("No connected MCP servers to disconnect.");
        return;
      }
      await host.disconnectAll();
      console.log(`Disconnected from ${names.length} server(s): ${names.join(", ")}.`);
    });
}
