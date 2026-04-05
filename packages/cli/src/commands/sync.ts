/**
 * arc sync — CLI commands for cloud/filesystem sync.
 *
 * Subcommands: status, push, pull, configure
 */
import pc from "picocolors";
import { SyncManager, FilesystemSyncProvider } from "@axiom-labs/arc-core";
import type { SyncConfig } from "@axiom-labs/arc-core";
import fs from "node:fs";
import path from "node:path";
import { getArcDir } from "@axiom-labs/arc-core";

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

function syncConfigPath(): string {
  return path.join(getArcDir(), "sync-config.json");
}

function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = fs.readFileSync(syncConfigPath(), "utf-8");
    return JSON.parse(raw) as SyncConfig;
  } catch {
    return null;
  }
}

function saveSyncConfig(config: SyncConfig): void {
  const dir = getArcDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(syncConfigPath(), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Manager bootstrapping
// ---------------------------------------------------------------------------

async function getConnectedManager(): Promise<SyncManager> {
  const config = loadSyncConfig();
  if (!config) {
    process.stderr.write(pc.red("No sync provider configured.") + "\n");
    process.stderr.write(pc.dim("Run `arc sync configure` to set up sync.") + "\n");
    process.exit(1);
  }

  const manager = new SyncManager();

  if (config.provider === "filesystem") {
    const provider = new FilesystemSyncProvider();
    await manager.setProvider(provider, config);
  } else {
    process.stderr.write(pc.red(`Unknown sync provider: ${config.provider}`) + "\n");
    process.exit(1);
  }

  return manager;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleSyncStatus(opts: {
  json?: boolean;
}): Promise<void> {
  const config = loadSyncConfig();

  if (!config) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ configured: false }, null, 2) + "\n");
      return;
    }
    process.stdout.write(pc.dim("Sync not configured.") + "\n");
    process.stdout.write(pc.dim("Run `arc sync configure --provider filesystem --path <dir>` to set up.") + "\n");
    return;
  }

  const manager = new SyncManager();

  if (config.provider === "filesystem") {
    try {
      const provider = new FilesystemSyncProvider();
      await manager.setProvider(provider, config);
    } catch {
      // Couldn't connect — still show config
    }
  }

  const status = manager.getStatus();

  if (opts.json) {
    process.stdout.write(JSON.stringify({ config, status }, null, 2) + "\n");
    return;
  }

  process.stdout.write(pc.bold("Sync Configuration") + "\n\n");
  process.stdout.write(`  Provider:     ${pc.bold(config.provider)}\n`);
  process.stdout.write(`  Enabled:      ${config.enabled ? pc.green("yes") : pc.dim("no")}\n`);
  process.stdout.write(`  Auto-sync:    ${config.autoSync ? pc.green("yes") : pc.dim("no")}\n`);
  process.stdout.write(`  Sync on launch: ${config.syncOnLaunch ? pc.green("yes") : pc.dim("no")}\n`);
  process.stdout.write(`  Sync on exit:   ${config.syncOnExit ? pc.green("yes") : pc.dim("no")}\n`);
  process.stdout.write(`  Interval:     ${pc.dim(String(config.syncIntervalMs) + "ms")}\n`);

  if (config.localOnlyProfiles.length > 0) {
    process.stdout.write(`  Local-only:   ${pc.dim(config.localOnlyProfiles.join(", "))}\n`);
  }
  if (config.exclude.length > 0) {
    process.stdout.write(`  Excludes:     ${pc.dim(config.exclude.join(", "))}\n`);
  }

  process.stdout.write(`\n  ${pc.bold("Connection:")}\n`);
  process.stdout.write(`  Connected:    ${status.connected ? pc.green("yes") : pc.red("no")}\n`);
  if (status.lastSyncAt) {
    process.stdout.write(`  Last sync:    ${pc.dim(status.lastSyncAt)}\n`);
  }
  if (status.lastSyncCursor) {
    process.stdout.write(`  Cursor:       ${pc.dim(status.lastSyncCursor)}\n`);
  }
}

export async function handleSyncPush(): Promise<void> {
  const manager = await getConnectedManager();

  process.stdout.write("Syncing (push)... ");

  try {
    const entries = await manager.sync();
    const count = Object.keys(entries).length;
    process.stdout.write(pc.green("done") + "\n");
    process.stdout.write(pc.dim(`  ${count} entries synced.\n`));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(pc.red("failed") + "\n");
    process.stderr.write(pc.red(msg) + "\n");
    process.exit(1);
  }
}

export async function handleSyncPull(): Promise<void> {
  const manager = await getConnectedManager();

  process.stdout.write("Syncing (pull)... ");

  try {
    const entries = await manager.sync();
    const count = Object.keys(entries).length;
    process.stdout.write(pc.green("done") + "\n");
    process.stdout.write(pc.dim(`  ${count} entries pulled.\n`));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(pc.red("failed") + "\n");
    process.stderr.write(pc.red(msg) + "\n");
    process.exit(1);
  }
}

export async function handleSyncConfigure(opts: {
  provider?: string;
  path?: string;
}): Promise<void> {
  const provider = opts.provider ?? "filesystem";

  if (provider === "filesystem" && !opts.path) {
    process.stderr.write(pc.red("Filesystem provider requires --path <directory>.") + "\n");
    process.exit(1);
  }

  const config: SyncConfig = {
    enabled: true,
    provider: provider === "filesystem" ? opts.path! : provider,
    autoSync: false,
    syncIntervalMs: 300_000, // 5 min
    syncOnLaunch: false,
    syncOnExit: false,
    localOnlyProfiles: [],
    exclude: [],
  };

  saveSyncConfig(config);

  process.stdout.write(pc.green("Sync configured") + "\n");
  process.stdout.write(`  Provider: ${pc.bold(provider)}\n`);
  if (opts.path) {
    process.stdout.write(`  Path:     ${pc.dim(opts.path)}\n`);
  }
  process.stdout.write(pc.dim("\n  Run `arc sync status` to verify connectivity.\n"));
}
