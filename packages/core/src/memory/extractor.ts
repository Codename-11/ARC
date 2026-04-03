/**
 * Auto-extraction heuristics — pull structured memory entries from
 * free-form conversation text.
 *
 * This is intentionally keyword-based (no ML) so it stays fast, offline,
 * and deterministic.
 */

import crypto from "node:crypto";
import type { MemoryEntry, MemoryType } from "./types.js";

// ---------------------------------------------------------------------------
// Pattern catalog
// ---------------------------------------------------------------------------

interface ExtractionRule {
  /** Regex applied to each line (case-insensitive). */
  pattern: RegExp;
  type: MemoryType;
  relevance: number;
  /** TTL override in seconds; undefined → use default 7-day half-life. */
  ttl?: number;
  /** Static tags merged into the extracted entry. */
  tags: string[];
}

const RULES: ExtractionRule[] = [
  // --- corrections ---
  {
    pattern:
      /(?:actually|no,?\s+(?:it|that)'s|correct(?:ion)?:?\s|wrong|instead[, ]+(?:it|use|do))/i,
    type: "correction",
    relevance: 0.95,
    ttl: 86_400 * 30, // 30 days
    tags: ["correction", "auto-extracted"],
  },
  {
    pattern: /(?:don'?t|do not|never|stop)\s+(?:use|do|call|run|apply|include)/i,
    type: "correction",
    relevance: 0.9,
    ttl: 86_400 * 30,
    tags: ["correction", "auto-extracted"],
  },

  // --- preferences ---
  {
    pattern:
      /(?:i (?:prefer|like|want|always use|always want)|(?:please )?(?:always|by default)\s+(?:use|do|include|add))/i,
    type: "preference",
    relevance: 0.85,
    tags: ["preference", "auto-extracted"],
  },
  {
    pattern:
      /(?:my (?:preferred|favorite|default)\s|(?:use|switch to)\s.*\binstead\b)/i,
    type: "preference",
    relevance: 0.8,
    tags: ["preference", "auto-extracted"],
  },

  // --- patterns ---
  {
    pattern:
      /(?:(?:every|each) time\b|(?:whenever|usually|typically|tends to)\b|(?:pattern|recurring):?\s)/i,
    type: "pattern",
    relevance: 0.6,
    tags: ["pattern", "auto-extracted"],
  },
  {
    pattern:
      /(?:(?:seems? like|looks? like|notice(?:d)?)\s.*(?:always|often|usually|keeps?))/i,
    type: "pattern",
    relevance: 0.55,
    tags: ["pattern", "auto-extracted"],
  },

  // --- decisions ---
  {
    pattern:
      /(?:(?:let'?s|we(?:'ll| will| should| decided to))\s+(?:go with|use|pick|choose|stick with|keep))/i,
    type: "decision",
    relevance: 0.7,
    tags: ["decision", "auto-extracted"],
  },
  {
    pattern:
      /(?:(?:decision|decided|choosing|chose):?\s)/i,
    type: "decision",
    relevance: 0.7,
    tags: ["decision", "auto-extracted"],
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan `text` for lines that match extraction heuristics and return a list
 * of candidate `MemoryEntry` objects.
 *
 * Each returned entry has:
 * - a unique `id` (crypto.randomUUID)
 * - `scope: 'session'` (caller can promote to persistent)
 * - `sourceSession` set from the provided `sessionId`
 *
 * Duplicate content within a single call is deduplicated.
 */
export function extractMemories(
  text: string,
  sessionId: string,
  sourceAgent?: string,
): MemoryEntry[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const seen = new Set<string>();
  const results: MemoryEntry[] = [];
  const now = new Date().toISOString();

  for (const line of lines) {
    const trimmed = line.trim();
    for (const rule of RULES) {
      if (!rule.pattern.test(trimmed)) continue;

      // Deduplicate by normalised content.
      const key = trimmed.toLowerCase();
      if (seen.has(key)) break;
      seen.add(key);

      results.push({
        id: crypto.randomUUID(),
        content: trimmed,
        type: rule.type,
        scope: "session",
        createdAt: now,
        lastAccessed: now,
        accessCount: 0,
        ttl: rule.ttl,
        relevanceScore: rule.relevance,
        tags: [...rule.tags],
        sourceSession: sessionId,
        sourceAgent,
      });

      // One match per line is enough.
      break;
    }
  }

  return results;
}
