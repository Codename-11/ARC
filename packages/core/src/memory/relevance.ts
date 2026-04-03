/**
 * Deterministic relevance search for memory entries.
 *
 * Ranking factors (no embeddings):
 *   1. Keyword overlap between query tokens and entry content + tags
 *   2. Scope priority: session > persistent > team
 *   3. Recency bias: recently-accessed entries score higher
 *   4. Type weighting: corrections & preferences > patterns > decisions > facts
 *
 * Pure function — all inputs explicit, no I/O.
 */

import type { MemoryEntry, MemorySearchOptions } from "./types.js";
import { decayScore } from "./aging.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCOPE_WEIGHT: Record<string, number> = {
  session: 1.0,
  persistent: 0.7,
  team: 0.4,
};

const TYPE_WEIGHT: Record<string, number> = {
  correction: 1.0,
  preference: 0.9,
  pattern: 0.7,
  decision: 0.6,
  fact: 0.5,
};

/** Recency window: entries accessed within this many seconds get a bonus. */
const RECENCY_WINDOW_SEC = 3_600; // 1 hour

// ---------------------------------------------------------------------------
// Tokeniser (simple, deterministic)
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search `memories` for entries most relevant to `query`.
 *
 * Each entry is scored as:
 *   score = keywordScore * typeWeight * scopeWeight * decayedRelevance + recencyBonus
 *
 * Entries below the minimum score (default 0.01) or failing scope/type/tag
 * filters are excluded.  Results are returned in descending score order.
 */
export function searchMemories(
  query: string,
  memories: MemoryEntry[],
  options: MemorySearchOptions = {},
): MemoryEntry[] {
  const {
    limit = 20,
    minScore = 0.01,
    types,
    scopes,
    tags,
    includeArchived = false,
  } = options;

  const now = new Date();
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) return [];

  const scored: Array<{ entry: MemoryEntry; score: number }> = [];

  for (const entry of memories) {
    // ---- hard filters ----
    if (types && !types.includes(entry.type)) continue;
    if (scopes && !scopes.includes(entry.scope)) continue;
    if (tags && tags.length > 0) {
      const entryTagSet = new Set(entry.tags.map((t) => t.toLowerCase()));
      if (!tags.some((t) => entryTagSet.has(t.toLowerCase()))) continue;
    }

    // ---- decay check ----
    const decayed = decayScore(entry, now);
    if (!includeArchived && decayed <= 0.1) continue;

    // ---- keyword match ----
    const contentTokens = tokenize(entry.content);
    const tagTokens = entry.tags.flatMap((t) => tokenize(t));
    const entryTokens = new Set([...contentTokens, ...tagTokens]);
    const matchCount = queryTokens.filter((qt) => entryTokens.has(qt)).length;
    if (matchCount === 0) continue;

    const keywordScore = matchCount / queryTokens.length; // 0-1

    // ---- scope weight ----
    const scopeWeight = SCOPE_WEIGHT[entry.scope] ?? 0.5;

    // ---- type weight ----
    const typeWeight = TYPE_WEIGHT[entry.type] ?? 0.5;

    // ---- recency bonus ----
    const lastAccessAge =
      (now.getTime() - new Date(entry.lastAccessed).getTime()) / 1_000;
    const recencyBonus = lastAccessAge < RECENCY_WINDOW_SEC ? 0.15 : 0;

    // ---- composite ----
    const score =
      keywordScore * typeWeight * scopeWeight * decayed + recencyBonus;

    if (score >= minScore) {
      scored.push({ entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}
