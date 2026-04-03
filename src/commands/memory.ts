/**
 * arc memory — CLI commands for the persistent memory store.
 *
 * Subcommands: list, search, prune, stats
 */
import pc from "picocolors";
import { PersistentMemory } from "../../packages/core/src/memory/index.js";
import type { MemoryScope, MemoryType } from "../../packages/core/src/memory/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCOPE_COLOR: Record<string, (s: string) => string> = {
  session: pc.cyan,
  persistent: pc.blue,
  team: pc.magenta,
};

const TYPE_COLOR: Record<string, (s: string) => string> = {
  fact: pc.white,
  preference: pc.green,
  correction: pc.yellow,
  pattern: pc.cyan,
  decision: pc.magenta,
};

function formatScope(scope: string): string {
  const color = SCOPE_COLOR[scope] ?? pc.white;
  return color(scope);
}

function formatType(type: string): string {
  const color = TYPE_COLOR[type] ?? pc.white;
  return color(type);
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

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleMemoryList(opts: {
  scope?: string;
  type?: string;
  limit?: string | number;
  json?: boolean;
}): Promise<void> {
  const scope = (opts.scope ?? "persistent") as MemoryScope;
  const mem = new PersistentMemory(scope);
  let entries = mem.list();

  if (opts.type) {
    entries = entries.filter((e) => e.type === opts.type);
  }

  const limit = typeof opts.limit === "string" ? Number.parseInt(opts.limit, 10) : (opts.limit ?? 20);
  if (Number.isFinite(limit) && limit > 0) {
    entries = entries.slice(0, limit);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
    return;
  }

  if (entries.length === 0) {
    process.stdout.write(pc.dim(`No memories found (scope: ${scope}).\n`));
    return;
  }

  const idW = 10;
  const typeW = 12;
  const scopeW = 12;
  const scoreW = 7;
  const accessW = 8;
  const agoW = 10;

  process.stdout.write(
    `  ${"ID".padEnd(idW)}${pc.dim("│")} ${"Type".padEnd(typeW)}${pc.dim("│")} ${"Scope".padEnd(scopeW)}${pc.dim("│")} ${"Score".padEnd(scoreW)}${pc.dim("│")} ${"Hits".padEnd(accessW)}${pc.dim("│")} ${"Accessed".padEnd(agoW)}${pc.dim("│")} Content\n`,
  );
  process.stdout.write(
    pc.dim(`  ${"─".repeat(idW)}┼${"─".repeat(typeW + 1)}┼${"─".repeat(scopeW + 1)}┼${"─".repeat(scoreW + 1)}┼${"─".repeat(accessW + 1)}┼${"─".repeat(agoW + 1)}┼${"─".repeat(30)}`) + "\n",
  );

  for (const entry of entries) {
    const id = pc.dim(entry.id.slice(0, 8));
    const type = formatType(entry.type);
    const entryScope = formatScope(entry.scope);
    const score = entry.relevanceScore.toFixed(2);
    const access = String(entry.accessCount);
    const ago = pc.dim(relativeTime(entry.lastAccessed));
    const content = truncate(entry.content.replace(/\n/g, " "), 40);

    process.stdout.write(
      `  ${id.padEnd(idW + 10)}${pc.dim("│")} ${type.padEnd(typeW + 10)}${pc.dim("│")} ${entryScope.padEnd(scopeW + 10)}${pc.dim("│")} ${score.padEnd(scoreW)}${pc.dim("│")} ${access.padEnd(accessW)}${pc.dim("│")} ${ago.padEnd(agoW + 10)}${pc.dim("│")} ${content}\n`,
    );
  }

  process.stdout.write(pc.dim(`\n  ${entries.length} memor${entries.length === 1 ? "y" : "ies"} shown.\n`));
}

export async function handleMemorySearch(
  query: string,
  opts: {
    limit?: string | number;
    json?: boolean;
  },
): Promise<void> {
  const mem = new PersistentMemory("persistent");
  const limit = typeof opts.limit === "string" ? Number.parseInt(opts.limit, 10) : (opts.limit ?? 20);

  const results = mem.search(query, {
    limit: Number.isFinite(limit) ? limit : 20,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return;
  }

  if (results.length === 0) {
    process.stdout.write(pc.dim("No matching memories found.\n"));
    return;
  }

  process.stdout.write(pc.bold(`Search results for "${query}"`) + "\n\n");

  for (const entry of results) {
    const id = pc.dim(entry.id.slice(0, 8));
    const type = formatType(entry.type);
    const score = pc.dim(`score=${entry.relevanceScore.toFixed(2)}`);
    const tags = entry.tags.length > 0 ? pc.dim(` [${entry.tags.join(", ")}]`) : "";
    const content = entry.content.replace(/\n/g, " ");

    process.stdout.write(`  ${id} ${type} ${score}${tags}\n`);
    process.stdout.write(`    ${truncate(content, 80)}\n\n`);
  }

  process.stdout.write(pc.dim(`  ${results.length} result(s).\n`));
}

export async function handleMemoryPrune(opts: {
  threshold?: string;
  hardDelete?: boolean;
}): Promise<void> {
  const threshold = opts.threshold ? Number.parseFloat(opts.threshold) : 0.1;

  const scopes: MemoryScope[] = ["session", "persistent", "team"];
  let totalPruned = 0;

  for (const scope of scopes) {
    const mem = new PersistentMemory(scope);
    const pruned = mem.prune({ threshold, hardDelete: opts.hardDelete });
    if (pruned > 0) {
      process.stdout.write(`  ${formatScope(scope)}: ${pc.yellow(String(pruned))} entries pruned\n`);
    }
    totalPruned += pruned;
  }

  if (totalPruned === 0) {
    process.stdout.write(pc.dim("No memories below threshold. Nothing to prune.\n"));
  } else {
    process.stdout.write(pc.green(`\n  ${totalPruned} total memor${totalPruned === 1 ? "y" : "ies"} pruned (threshold=${threshold}).\n`));
  }
}

export async function handleMemoryStats(): Promise<void> {
  const scopes: MemoryScope[] = ["session", "persistent", "team"];

  process.stdout.write(pc.bold("Memory Statistics") + "\n\n");

  let grandTotal = 0;
  const typeCounts: Record<string, number> = {};

  for (const scope of scopes) {
    const mem = new PersistentMemory(scope);
    const entries = mem.list();
    const archived = mem.list(true).length - entries.length;

    grandTotal += entries.length;

    process.stdout.write(`  ${formatScope(scope).padEnd(22)} ${pc.bold(String(entries.length))} active`);
    if (archived > 0) {
      process.stdout.write(pc.dim(`, ${archived} archived`));
    }
    process.stdout.write("\n");

    for (const entry of entries) {
      typeCounts[entry.type] = (typeCounts[entry.type] ?? 0) + 1;
    }
  }

  process.stdout.write(`\n  ${pc.bold("By type:")}\n`);
  for (const [type, count] of Object.entries(typeCounts)) {
    process.stdout.write(`    ${formatType(type).padEnd(22)} ${count}\n`);
  }

  process.stdout.write(pc.dim(`\n  ${grandTotal} total active memories.\n`));
}
