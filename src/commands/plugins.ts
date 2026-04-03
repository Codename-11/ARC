/**
 * arc plugins — CLI commands for plugin management.
 *
 * Subcommands: list, install, uninstall, enable, disable
 */
import pc from "picocolors";
import { PluginRegistry } from "../../packages/core/src/plugins/index.js";

const registry = new PluginRegistry();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEnabled(enabled: boolean): string {
  return enabled ? pc.green("enabled") : pc.dim("disabled");
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handlePluginsList(opts: {
  json?: boolean;
}): Promise<void> {
  const plugins = registry.list();

  if (opts.json) {
    process.stdout.write(JSON.stringify(plugins, null, 2) + "\n");
    return;
  }

  if (plugins.length === 0) {
    process.stdout.write(pc.dim("No plugins installed.\n"));
    return;
  }

  const nameW = Math.max(6, ...plugins.map((p) => p.manifest.name.length)) + 2;
  const verW = 10;
  const stateW = 10;
  const capsW = 24;

  process.stdout.write(
    `  ${"Name".padEnd(nameW)}${pc.dim("│")} ${"Version".padEnd(verW)}${pc.dim("│")} ${"State".padEnd(stateW)}${pc.dim("│")} ${"Capabilities".padEnd(capsW)}${pc.dim("│")} Installed\n`,
  );
  process.stdout.write(
    pc.dim(`  ${"─".repeat(nameW)}┼${"─".repeat(verW + 1)}┼${"─".repeat(stateW + 1)}┼${"─".repeat(capsW + 1)}┼${"─".repeat(14)}`) + "\n",
  );

  for (const plugin of plugins) {
    const name = pc.bold(plugin.manifest.name);
    const ver = pc.dim(`v${plugin.manifest.version}`);
    const state = formatEnabled(plugin.enabled);
    const caps = plugin.manifest.capabilities.join(", ");
    const installed = pc.dim(relativeTime(plugin.installedAt));

    process.stdout.write(
      `  ${name.padEnd(nameW + 10)}${pc.dim("│")} ${ver.padEnd(verW + 10)}${pc.dim("│")} ${state.padEnd(stateW + 10)}${pc.dim("│")} ${caps.padEnd(capsW)}${pc.dim("│")} ${installed}\n`,
    );
  }

  process.stdout.write(pc.dim(`\n  ${plugins.length} plugin(s) installed.\n`));
}

export async function handlePluginsInstall(pluginPath: string): Promise<void> {
  try {
    const plugin = registry.install(pluginPath);
    process.stdout.write(pc.green("Plugin installed") + "\n");
    process.stdout.write(`  Name:         ${pc.bold(plugin.manifest.name)}\n`);
    process.stdout.write(`  Version:      ${pc.dim(`v${plugin.manifest.version}`)}\n`);
    process.stdout.write(`  Description:  ${plugin.manifest.description}\n`);
    process.stdout.write(`  Capabilities: ${plugin.manifest.capabilities.join(", ")}\n`);
    process.stdout.write(`  Path:         ${pc.dim(plugin.path)}\n`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(pc.red(msg) + "\n");
    process.exit(1);
  }
}

export async function handlePluginsUninstall(name: string): Promise<void> {
  try {
    registry.uninstall(name);
    process.stdout.write(pc.green(`Plugin '${name}' uninstalled.`) + "\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(pc.red(msg) + "\n");
    process.exit(1);
  }
}

export async function handlePluginsEnable(name: string): Promise<void> {
  try {
    registry.enable(name);
    process.stdout.write(pc.green(`Plugin '${name}' enabled.`) + "\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(pc.red(msg) + "\n");
    process.exit(1);
  }
}

export async function handlePluginsDisable(name: string): Promise<void> {
  try {
    registry.disable(name);
    process.stdout.write(pc.yellow(`Plugin '${name}' disabled.`) + "\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(pc.red(msg) + "\n");
    process.exit(1);
  }
}
