/**
 * SessionMemory — in-memory, ephemeral memory store.
 *
 * Entries live only for the lifetime of the process.  Useful for
 * conversation-scoped context that should not persist across restarts.
 */

import crypto from "node:crypto";
import { writeLogEvent } from "../logging.js";
import type {
  MemoryEntry,
  MemoryPruneOptions,
  MemorySearchOptions,
  MemoryType,
} from "./types.js";
import { decayScore, isExpired } from "./aging.js";
import { searchMemories } from "./relevance.js";

export class SessionMemory {
  private entries = new Map<string, MemoryEntry>();
  private archived = new Map<string, MemoryEntry>();
  private readonly sessionId: string;

  constructor(sessionId?: string) {
    this.sessionId = sessionId ?? crypto.randomUUID();
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
      sourceAgent?: string;
    } = {},
  ): MemoryEntry {
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      content,
      type,
      scope: "session",
      createdAt: now,
      lastAccessed: now,
      accessCount: 0,
      ttl: options.ttl,
      relevanceScore: options.relevanceScore ?? 0.8,
      tags: options.tags ?? [],
      sourceSession: this.sessionId,
      sourceAgent: options.sourceAgent,
    };

    this.entries.set(entry.id, entry);

    writeLogEvent({
      level: "debug",
      component: "memory",
      action: "session-add",
      message: `Added session memory: ${entry.id}`,
      data: { type, tags: entry.tags },
    });

    return entry;
  }

  get(id: string): MemoryEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;

    // Touch: update access metadata.
    entry.lastAccessed = new Date().toISOString();
    entry.accessCount += 1;
    return entry;
  }

  update(
    id: string,
    patch: Partial<Pick<MemoryEntry, "content" | "tags" | "ttl" | "relevanceScore" | "type">>,
  ): MemoryEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;

    if (patch.content !== undefined) entry.content = patch.content;
    if (patch.tags !== undefined) entry.tags = patch.tags;
    if (patch.ttl !== undefined) entry.ttl = patch.ttl;
    if (patch.relevanceScore !== undefined) entry.relevanceScore = patch.relevanceScore;
    if (patch.type !== undefined) entry.type = patch.type;
    entry.lastAccessed = new Date().toISOString();

    return entry;
  }

  delete(id: string): boolean {
    return this.entries.delete(id) || this.archived.delete(id);
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  list(includeArchived = false): MemoryEntry[] {
    const active = [...this.entries.values()];
    if (!includeArchived) return active;
    return [...active, ...this.archived.values()];
  }

  search(query: string, options?: MemorySearchOptions): MemoryEntry[] {
    const pool = options?.includeArchived
      ? [...this.entries.values(), ...this.archived.values()]
      : [...this.entries.values()];
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
    let pruned = 0;

    for (const [id, entry] of this.entries) {
      if (isExpired(entry, now, threshold)) {
        this.entries.delete(id);
        if (!hardDelete) {
          this.archived.set(id, entry);
        }
        pruned += 1;
      }
    }

    if (pruned > 0) {
      writeLogEvent({
        level: "info",
        component: "memory",
        action: "session-prune",
        message: `Pruned ${pruned} session memories (threshold=${threshold}, hard=${hardDelete})`,
      });
    }

    return pruned;
  }

  /**
   * Return the effective (decayed) score for an entry.
   */
  score(id: string): number | undefined {
    const entry = this.entries.get(id) ?? this.archived.get(id);
    if (!entry) return undefined;
    return decayScore(entry);
  }

  /** Number of active (non-archived) entries. */
  get size(): number {
    return this.entries.size;
  }

  /** Current session ID. */
  get session(): string {
    return this.sessionId;
  }

  /** Clear all entries (active and archived). */
  clear(): void {
    this.entries.clear();
    this.archived.clear();
  }
}
