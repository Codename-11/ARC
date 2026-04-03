/**
 * Memory aging — TTL-based relevance decay with access-count boost.
 *
 * Pure functions; no side effects.
 */

import type { MemoryEntry } from "./types.js";

/** Default half-life: 7 days in seconds. */
const DEFAULT_HALF_LIFE = 86_400 * 7;

/**
 * Compute the effective relevance score for a memory entry at a given point
 * in time.  The score decays exponentially from `entry.relevanceScore`,
 * halving every `entry.ttl` seconds (default 7 days), with a small additive
 * boost proportional to `entry.accessCount`.
 *
 * @returns A clamped value in the range [0, 1].
 */
export function decayScore(entry: MemoryEntry, now: Date = new Date()): number {
  const ageSec =
    (now.getTime() - new Date(entry.lastAccessed).getTime()) / 1_000;
  const halfLife = entry.ttl ?? DEFAULT_HALF_LIFE;
  const decay = Math.pow(0.5, ageSec / halfLife);
  const accessBoost = Math.min(entry.accessCount * 0.05, 0.3);
  return Math.min(1, entry.relevanceScore * decay + accessBoost);
}

/**
 * Return `true` when the entry's effective score is at or below the archive
 * threshold (default 0.1).
 */
export function isExpired(
  entry: MemoryEntry,
  now: Date = new Date(),
  threshold = 0.1,
): boolean {
  return decayScore(entry, now) <= threshold;
}
