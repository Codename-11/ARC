/**
 * arc remote — CLI commands for remote agent management.
 *
 * Subcommands: list, add, remove, check
 */
import pc from "picocolors";
import { RemoteAgentRegistry, checkHealth } from "@axiom-labs/arc-core";
import type { RemoteAgentTransport } from "@axiom-labs/arc-core";

const registry = new RemoteAgentRegistry();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<string, (s: string) => string> = {
  online: pc.green,
  offline: pc.red,
  unknown: pc.dim,
};

function formatStatus(status: string): string {
  const color = STATUS_COLOR[status] ?? pc.white;
  return color(status);
}

const TRANSPORT_COLOR: Record<string, (s: string) => string> = {
  http: pc.cyan,
  ssh: pc.yellow,
  mcp: pc.magenta,
};

function formatTransport(transport: string): string {
  const color = TRANSPORT_COLOR[transport] ?? pc.white;
  return color(transport);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleRemoteList(opts: {
  json?: boolean;
}): Promise<void> {
  const agents = registry.list();

  if (opts.json) {
    process.stdout.write(JSON.stringify(agents, null, 2) + "\n");
    return;
  }

  if (agents.length === 0) {
    process.stdout.write(pc.dim("No remote agents registered.\n"));
    return;
  }

  const nameW = Math.max(6, ...agents.map((a) => a.name.length)) + 2;
  const endpointW = Math.max(10, ...agents.map((a) => a.endpoint.length)) + 2;
  const transportW = 10;
  const statusW = 10;

  process.stdout.write(
    `  ${"Name".padEnd(nameW)}${pc.dim("│")} ${"Endpoint".padEnd(endpointW)}${pc.dim("│")} ${"Transport".padEnd(transportW)}${pc.dim("│")} ${"Status".padEnd(statusW)}${pc.dim("│")} Profile\n`,
  );
  process.stdout.write(
    pc.dim(`  ${"─".repeat(nameW)}┼${"─".repeat(endpointW + 1)}┼${"─".repeat(transportW + 1)}┼${"─".repeat(statusW + 1)}┼${"─".repeat(12)}`) + "\n",
  );

  for (const agent of agents) {
    const name = pc.bold(agent.name);
    const endpoint = pc.dim(agent.endpoint);
    const transport = formatTransport(agent.transport);
    const status = formatStatus(agent.status);
    const profile = agent.profile ?? pc.dim("—");

    process.stdout.write(
      `  ${name.padEnd(nameW + 10)}${pc.dim("│")} ${endpoint.padEnd(endpointW + 10)}${pc.dim("│")} ${transport.padEnd(transportW + 10)}${pc.dim("│")} ${status.padEnd(statusW + 10)}${pc.dim("│")} ${profile}\n`,
    );
  }

  process.stdout.write(pc.dim(`\n  ${agents.length} agent(s) registered.\n`));
}

export async function handleRemoteAdd(
  name: string,
  endpoint: string,
  opts: {
    transport?: string;
    profile?: string;
  },
): Promise<void> {
  const transport = (opts.transport ?? "http") as RemoteAgentTransport;

  const agent = registry.register({
    name,
    endpoint,
    transport,
    profile: opts.profile,
    status: "unknown",
  });

  process.stdout.write(pc.green("Remote agent registered") + "\n");
  process.stdout.write(`  ID:        ${pc.dim(agent.id)}\n`);
  process.stdout.write(`  Name:      ${pc.bold(agent.name)}\n`);
  process.stdout.write(`  Endpoint:  ${pc.dim(agent.endpoint)}\n`);
  process.stdout.write(`  Transport: ${formatTransport(agent.transport)}\n`);
  if (agent.profile) {
    process.stdout.write(`  Profile:   ${agent.profile}\n`);
  }
}

export async function handleRemoteRemove(id: string): Promise<void> {
  try {
    registry.unregister(id);
    process.stdout.write(pc.green("Remote agent removed.") + "\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(pc.red(msg) + "\n");
    process.exit(1);
  }
}

export async function handleRemoteCheck(id?: string): Promise<void> {
  if (id) {
    const agent = registry.get(id);
    if (!agent) {
      process.stderr.write(pc.red(`Remote agent '${id}' not found.`) + "\n");
      process.exit(1);
    }

    process.stdout.write(`Checking ${pc.bold(agent.name)} (${pc.dim(agent.endpoint)})... `);
    const status = await checkHealth(agent);
    registry.updateStatus(agent.id, status);
    process.stdout.write(formatStatus(status) + "\n");
  } else {
    const agents = registry.list();
    if (agents.length === 0) {
      process.stdout.write(pc.dim("No remote agents to check.\n"));
      return;
    }

    process.stdout.write(pc.bold("Health check — all agents") + "\n\n");
    let online = 0;

    for (const agent of agents) {
      process.stdout.write(`  ${pc.bold(agent.name).padEnd(30)} `);
      const status = await checkHealth(agent);
      registry.updateStatus(agent.id, status);
      process.stdout.write(formatStatus(status) + "\n");
      if (status === "online") online++;
    }

    process.stdout.write(pc.dim(`\n  ${online}/${agents.length} online.\n`));
  }
}
