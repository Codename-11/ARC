/**
 * Memory system types for ARC Phase 15.
 *
 * Provides structured memory entries with scoping, aging/decay,
 * relevance scoring, and auto-extraction metadata.
 */

// ---------------------------------------------------------------------------
// Core enums / unions
// ---------------------------------------------------------------------------

export type MemoryType =
  | "fact"
  | "preference"
  | "correction"
  | "pattern"
  | "decision";

export type MemoryScope = "session" | "persistent" | "team";

// ---------------------------------------------------------------------------
// Memory entry
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  content: string;
  type: MemoryType;
  scope: MemoryScope;
  createdAt: string;
  lastAccessed: string;
  accessCount: number;
  /** Seconds until relevance decay starts.  Defaults to 7 days (604 800 s). */
  ttl?: number;
  /** Current relevance score in the range [0, 1]. Decays over time. */
  relevanceScore: number;
  tags: string[];
  sourceSession: string;
  sourceAgent?: string;
}

// ---------------------------------------------------------------------------
// Search options
// ---------------------------------------------------------------------------

export interface MemorySearchOptions {
  /** Maximum number of results to return. */
  limit?: number;
  /** Minimum effective relevance score after decay. */
  minScore?: number;
  /** Only return entries matching these types. */
  types?: MemoryType[];
  /** Only return entries matching these scopes. */
  scopes?: MemoryScope[];
  /** Only return entries that carry at least one of these tags. */
  tags?: string[];
  /** Include archived (below-threshold) entries in results. */
  includeArchived?: boolean;
}

// ---------------------------------------------------------------------------
// Prune options
// ---------------------------------------------------------------------------

export interface MemoryPruneOptions {
  /** Score threshold below which entries are considered archived.  Default 0.1. */
  threshold?: number;
  /** If true, permanently delete entries below threshold instead of archiving. */
  hardDelete?: boolean;
}

// ---------------------------------------------------------------------------
// Storage file shape (JSON on disk)
// ---------------------------------------------------------------------------

export interface MemoryStore {
  entries: MemoryEntry[];
  /** Entries that fell below the relevance threshold but are recoverable. */
  archived: MemoryEntry[];
}
