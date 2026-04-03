/**
 * PersistentMemory — JSON-file-backed durable memory store.
 *
 * Data lives at `~/.arc/memory/<scope>.json` (one file per scope).
 * Reads/writes are synchronous to match the rest of the ARC core I/O style.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getArcDir } from "../paths.js";
import { writeLogEvent } from "../logging.js";
import type {
  MemoryEntry,
  MemoryPruneOptions,
  MemoryScope,
  MemorySearchOptions,
  MemoryStore,
  MemoryType,
} from "./types.js";
import { decayScore, isExpired } from "./aging.js";
import { searchMemories } from "./relevance.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function memoryDir(): string {
  return path.join(getArcDir(), "memory");
}

function storePathFor(scope: MemoryScope): string {
  return path.join(memoryDir(), `${scope}.json`);
}

function readStore(scope: MemoryScope): MemoryStore {
  const filePath = storePathFor(scope);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<MemoryStore>;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      archived: Array.isArray(parsed.archived) ? parsed.archived : [],
    };
  } catch {
    return { entries: [], archived: [] };
  }
}

function writeStore(scope: MemoryScope, store: MemoryStore): void {
  const dir = memoryDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    storePathFor(scope),
    JSON.stringify(store, null, 2) + "\n",
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// PersistentMemory class
// ---------------------------------------------------------------------------

export class PersistentMemory {
  private readonly scope: MemoryScope;

  /**
   * @param scope  Which scope file to back this store with.
   *               Defaults to `'persistent'`.
   */
  constructor(scope: MemoryScope = "persistent") {
    this.scope = scope;
  }

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  add(
    content: string,
    type: MemoryType,
    options: {
      tags?: string[];
      ttl?: number;
      relevanceScore?: number;
      sourceSession?: string;
      sourceAgent?: string;
    } = {},
  ): MemoryEntry {
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      content,
      type,
      scope: this.scope,
      createdAt: now,
      lastAccessed: now,
      accessCount: 0,
      ttl: options.ttl,
      relevanceScore: options.relevanceScore ?? 0.8,
      tags: options.tags ?? [],
      sourceSession: options.sourceSession ?? "unknown",
      sourceAgent: options.sourceAgent,
    };

    const store = readStore(this.scope);
    store.entries.push(entry);
    writeStore(this.scope, store);

    writeLogEvent({
      level: "debug",
      component: "memory",
      action: "persistent-add",
      message: `Added persistent memory: ${entry.id}`,
      data: { scope: this.scope, type, tags: entry.tags },
    });

    return entry;
  }

  get(id: string): MemoryEntry | undefined {
    const store = readStore(this.scope);
    const entry = store.entries.find((e) => e.id === id);
    if (!entry) return undefined;

    // Touch: update access metadata and persist.
    entry.lastAccessed = new Date().toISOString();
    entry.accessCount += 1;
    writeStore(this.scope, store);

    return entry;
  }

  update(
    id: string,
    patch: Partial<Pick<MemoryEntry, "content" | "tags" | "ttl" | "relevanceScore" | "type">>,
  ): MemoryEntry | undefined {
    const store = readStore(this.scope);
    const entry = store.entries.find((e) => e.id === id);
    if (!entry) return undefined;

    if (patch.content !== undefined) entry.content = patch.content;
    if (patch.tags !== undefined) entry.tags = patch.tags;
    if (patch.ttl !== undefined) entry.ttl = patch.ttl;
    if (patch.relevanceScore !== undefined) entry.relevanceScore = patch.relevanceScore;
    if (patch.type !== undefined) entry.type = patch.type;
    entry.lastAccessed = new Date().toISOString();

    writeStore(this.scope, store);
    return entry;
  }

  delete(id: string): boolean {
    const store = readStore(this.scope);

    const activeIdx = store.entries.findIndex((e) => e.id === id);
    if (activeIdx !== -1) {
      store.entries.splice(activeIdx, 1);
      writeStore(this.scope, store);
      return true;
    }

    const archivedIdx = store.archived.findIndex((e) => e.id === id);
    if (archivedIdx !== -1) {
      store.archived.splice(archivedIdx, 1);
      writeStore(this.scope, store);
      return true;
    }

    return false;
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  list(includeArchived = false): MemoryEntry[] {
    const store = readStore(this.scope);
    if (!includeArchived) return store.entries;
    return [...store.entries, ...store.archived];
  }

  search(query: string, options?: MemorySearchOptions): MemoryEntry[] {
    const store = readStore(this.scope);
    const pool = options?.includeArchived
      ? [...store.entries, ...store.archived]
      : store.entries;
    return searchMemories(query, pool, options);
  }

  // -----------------------------------------------------------------------
  // Maintenance
  // -----------------------------------------------------------------------

  /**
   * Move entries whose decayed score is below `threshold` into the archive.
   * If `hardDelete` is set, remove them entirely instead.
   *
   * @returns Number of entries pruned.
   */
  prune(options: MemoryPruneOptions = {}): number {
    const { threshold = 0.1, hardDelete = false } = options;
    const now = new Date();
    const store = readStore(this.scope);

    const keep: MemoryEntry[] = [];
    let pruned = 0;

    for (const entry of store.entries) {
      if (isExpired(entry, now, threshold)) {
        if (!hardDelete) {
          store.archived.push(entry);
        }
        pruned += 1;
      } else {
        keep.push(entry);
      }
    }

    if (pruned > 0) {
      store.entries = keep;
      writeStore(this.scope, store);

      writeLogEvent({
        level: "info",
        component: "memory",
        action: "persistent-prune",
        message: `Pruned ${pruned} persistent memories (scope=${this.scope}, threshold=${threshold}, hard=${hardDelete})`,
      });
    }

    return pruned;
  }

  /**
   * Return the effective (decayed) score for an entry.
   */
  score(id: string): number | undefined {
    const store = readStore(this.scope);
    const entry =
      store.entries.find((e) => e.id === id) ??
      store.archived.find((e) => e.id === id);
    if (!entry) return undefined;
    return decayScore(entry);
  }

  /** Number of active (non-archived) entries. */
  get size(): number {
    return readStore(this.scope).entries.length;
  }

  /** The scope this store is backed by. */
  get storeScope(): MemoryScope {
    return this.scope;
  }

  /**
   * Restore an archived entry back to active status.
   * Resets its relevance score and access timestamp.
   */
  restore(id: string, relevanceScore = 0.5): MemoryEntry | undefined {
    const store = readStore(this.scope);
    const idx = store.archived.findIndex((e) => e.id === id);
    if (idx === -1) return undefined;

    const [entry] = store.archived.splice(idx, 1);
    entry.relevanceScore = relevanceScore;
    entry.lastAccessed = new Date().toISOString();
    entry.accessCount = 0;
    store.entries.push(entry);

    writeStore(this.scope, store);

    writeLogEvent({
      level: "info",
      component: "memory",
      action: "persistent-restore",
      message: `Restored archived memory: ${entry.id}`,
    });

    return entry;
  }
}
