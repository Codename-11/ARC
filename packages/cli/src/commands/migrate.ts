/**
 * arc migrate v2-to-v3 — offline ingest of v2 state into the v3 SQLite store.
 *
 * Runs against the database file directly — does NOT require the daemon to be
 * running. Idempotent: a second invocation reports "already migrated".
 */

import pc from "picocolors";
import { loadDaemonConfig, migrateV2ToV3, type MigrationReport } from "@axiom-labs/arc-daemon";
import { info, error, success } from "../display.js";

export interface MigrateOptions {
  dryRun?: boolean;
  json?: boolean;
}

export async function handleMigrate(opts: MigrateOptions): Promise<void> {
  const cfg = loadDaemonConfig();
  let report: MigrationReport;
  try {
    report = await migrateV2ToV3({
      arcDir: cfg.arcDir,
      dbPath: cfg.dbPath,
      dryRun: opts.dryRun ?? false,
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({ ok: false, error: msg }, null, 2) + "\n",
      );
    } else {
      error(`migration failed: ${msg}`);
    }
    process.exit(1);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ ok: true, ...report }, null, 2) + "\n");
    return;
  }

  if (report.alreadyMigrated) {
    info("already migrated, nothing to do");
    return;
  }

  const prefix = report.dryRun ? pc.cyan("[dry-run]") : pc.green("[migrate]");
  process.stdout.write(`${prefix} arcDir: ${cfg.arcDir}\n`);
  process.stdout.write(`${prefix} dbPath: ${cfg.dbPath}\n`);
  process.stdout.write(`${prefix} profiles:     ${report.profiles}\n`);
  process.stdout.write(`${prefix} agents:       ${report.agents}\n`);
  process.stdout.write(`${prefix} events:       ${report.events}\n`);
  process.stdout.write(`${prefix} chat msgs:    ${report.chatMessages}\n`);
  process.stdout.write(`${prefix} skipped:      ${report.skipped}\n`);
  if (report.errors.length > 0) {
    process.stdout.write(pc.yellow(`${prefix} errors: ${report.errors.length}\n`));
    for (const e of report.errors) {
      process.stdout.write(pc.yellow(`   - ${e}\n`));
    }
  }
  if (report.dryRun) {
    info("dry-run complete — no changes written");
  } else {
    success(`migration complete — v2 files preserved`);
  }
}
