import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { decayScore } from "../../packages/core/src/memory/aging.js";
import { searchMemories } from "../../packages/core/src/memory/relevance.js";
import { extractMemories } from "../../packages/core/src/memory/extractor.js";
import { SessionMemory } from "../../packages/core/src/memory/session-memory.js";
import { PersistentMemory } from "../../packages/core/src/memory/persistent-memory.js";
import type { MemoryEntry } from "../../packages/core/src/memory/types.js";

// Suppress log I/O during tests
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

// ─── Temp dir (for PersistentMemory) ────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-memory-test-"));
  process.env["ARC_DIR"] = tmpDir;
});

afterEach(() => {
  delete process.env["ARC_DIR"];
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

// ─── Helpers ────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = new Date().toISOString();
  return {
    id: "test-id",
    content: "test content",
    type: "fact",
    scope: "session",
    createdAt: now,
    lastAccessed: now,
    accessCount: 0,
    relevanceScore: 0.8,
    tags: [],
    sourceSession: "test-session",
    ...overrides,
  };
}

// ─── decayScore ─────────────────────────────────────────────────────

describe("decayScore()", () => {
  it("returns the base relevance score for a freshly created entry", () => {
    const entry = makeEntry({ relevanceScore: 0.8, accessCount: 0 });
    const score = decayScore(entry, new Date());
    // Fresh entry: decay factor ~1, no access boost → ~0.8
    expect(score).toBeCloseTo(0.8, 1);
  });

  it("decays over time", () => {
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const entry = makeEntry({
      relevanceScore: 0.8,
      lastAccessed: past.toISOString(),
      accessCount: 0,
    });
    const score = decayScore(entry, new Date());
    // After one half-life (7 days), score should be ~0.4
    expect(score).toBeLessThan(0.6);
    expect(score).toBeGreaterThan(0.2);
  });

  it("decays more over longer periods", () => {
    const past14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000); // 14 days ago
    const past7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

    const entry14 = makeEntry({
      relevanceScore: 0.8,
      lastAccessed: past14.toISOString(),
      accessCount: 0,
    });
    const entry7 = makeEntry({
      relevanceScore: 0.8,
      lastAccessed: past7.toISOString(),
      accessCount: 0,
    });

    const score14 = decayScore(entry14, new Date());
    const score7 = decayScore(entry7, new Date());
    expect(score14).toBeLessThan(score7);
  });

  it("access boost increases the score", () => {
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const entryNoAccess = makeEntry({
      relevanceScore: 0.8,
      lastAccessed: past.toISOString(),
      accessCount: 0,
    });
    const entryWithAccess = makeEntry({
      relevanceScore: 0.8,
      lastAccessed: past.toISOString(),
      accessCount: 5,
    });

    const scoreNoAccess = decayScore(entryNoAccess, new Date());
    const scoreWithAccess = decayScore(entryWithAccess, new Date());
    expect(scoreWithAccess).toBeGreaterThan(scoreNoAccess);
  });

  it("clamps score to max 1.0", () => {
    const entry = makeEntry({
      relevanceScore: 1.0,
      accessCount: 10,
    });
    const score = decayScore(entry, new Date());
    expect(score).toBeLessThanOrEqual(1.0);
  });
});

// ─── searchMemories ─────────────────────────────────────────────────

describe("searchMemories()", () => {
  it("returns entries matching query keywords", () => {
    const entries = [
      makeEntry({ id: "1", content: "use typescript for all projects", tags: ["typescript"] }),
      makeEntry({ id: "2", content: "python is great for scripting" }),
      makeEntry({ id: "3", content: "typescript strict mode preferred" }),
    ];

    const results = searchMemories("typescript", entries);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((e) => e.id === "1")).toBe(true);
  });

  it("returns empty array for no keyword matches", () => {
    const entries = [
      makeEntry({ id: "1", content: "use typescript for projects" }),
    ];
    const results = searchMemories("python", entries);
    expect(results).toHaveLength(0);
  });

  it("returns empty array for empty query", () => {
    const entries = [makeEntry({ id: "1", content: "hello world" })];
    const results = searchMemories("", entries);
    expect(results).toHaveLength(0);
  });

  it("filters by scope", () => {
    const entries = [
      makeEntry({ id: "1", content: "test fact", scope: "session" }),
      makeEntry({ id: "2", content: "test fact", scope: "persistent" }),
    ];

    const results = searchMemories("test fact", entries, {
      scopes: ["session"],
    });
    expect(results.every((e) => e.scope === "session")).toBe(true);
  });

  it("filters by type", () => {
    const entries = [
      makeEntry({ id: "1", content: "prefer dark mode", type: "preference" }),
      makeEntry({ id: "2", content: "prefer tabs", type: "fact" }),
    ];

    const results = searchMemories("prefer", entries, {
      types: ["preference"],
    });
    expect(results.every((e) => e.type === "preference")).toBe(true);
  });

  it("weights corrections higher than facts", () => {
    const entries = [
      makeEntry({ id: "1", content: "use spaces", type: "fact", relevanceScore: 0.8 }),
      makeEntry({ id: "2", content: "use spaces", type: "correction", relevanceScore: 0.8 }),
    ];

    const results = searchMemories("use spaces", entries);
    expect(results).toHaveLength(2);
    // Correction should rank first due to higher type weight
    expect(results[0].type).toBe("correction");
  });

  it("respects the limit option", () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ id: `id-${i}`, content: `item number ${i}` }),
    );

    const results = searchMemories("item number", entries, { limit: 3 });
    expect(results).toHaveLength(3);
  });
});

// ─── extractMemories ────────────────────────────────────────────────

describe("extractMemories()", () => {
  it("detects corrections with 'don't use'", () => {
    const results = extractMemories("don't use var in JavaScript", "s1");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("correction");
  });

  it("detects corrections with 'stop doing'", () => {
    const results = extractMemories("stop doing that pattern", "s1");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("correction");
  });

  it("detects preferences with 'I prefer'", () => {
    const results = extractMemories("I prefer functional style", "s1");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("preference");
  });

  it("detects preferences with 'always use'", () => {
    const results = extractMemories("always use strict mode", "s1");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("preference");
  });

  it("detects patterns with 'every time'", () => {
    const results = extractMemories("every time I run the build it fails", "s1");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("pattern");
  });

  it("detects decisions with 'let's go with'", () => {
    const results = extractMemories("let's go with approach B", "s1");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("decision");
  });

  it("returns empty array for text with no matches", () => {
    const results = extractMemories("The weather is nice today.", "s1");
    expect(results).toHaveLength(0);
  });

  it("deduplicates identical lines", () => {
    const text = "don't use var\ndon't use var\ndon't use var";
    const results = extractMemories(text, "s1");
    expect(results).toHaveLength(1);
  });

  it("sets scope to 'session' on extracted entries", () => {
    const results = extractMemories("I prefer tabs", "s1");
    expect(results[0].scope).toBe("session");
  });

  it("sets sourceSession from the argument", () => {
    const results = extractMemories("I prefer tabs", "session-abc");
    expect(results[0].sourceSession).toBe("session-abc");
  });

  it("includes auto-extracted tag", () => {
    const results = extractMemories("I prefer tabs", "s1");
    expect(results[0].tags).toContain("auto-extracted");
  });
});

// ─── SessionMemory ──────────────────────────────────────────────────

describe("SessionMemory", () => {
  let mem: SessionMemory;

  beforeEach(() => {
    mem = new SessionMemory("test-session");
  });

  it("add() creates an entry and increments size", () => {
    const entry = mem.add("test fact", "fact");
    expect(entry.id).toBeDefined();
    expect(entry.content).toBe("test fact");
    expect(mem.size).toBe(1);
  });

  it("get() retrieves by ID and increments accessCount", () => {
    const entry = mem.add("test", "fact");
    const retrieved = mem.get(entry.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.accessCount).toBe(1);
  });

  it("get() returns undefined for missing ID", () => {
    expect(mem.get("nonexistent")).toBeUndefined();
  });

  it("search() finds entries by keyword", () => {
    mem.add("typescript best practices", "fact", { tags: ["ts"] });
    mem.add("python scripting tips", "fact");

    const results = mem.search("typescript");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain("typescript");
  });

  it("delete() removes an entry", () => {
    const entry = mem.add("to delete", "fact");
    expect(mem.delete(entry.id)).toBe(true);
    expect(mem.get(entry.id)).toBeUndefined();
    expect(mem.size).toBe(0);
  });

  it("delete() returns false for missing ID", () => {
    expect(mem.delete("nonexistent")).toBe(false);
  });

  it("clear() removes all entries", () => {
    mem.add("fact 1", "fact");
    mem.add("fact 2", "fact");
    expect(mem.size).toBe(2);

    mem.clear();
    expect(mem.size).toBe(0);
    expect(mem.list()).toHaveLength(0);
  });

  it("session getter returns the session ID", () => {
    expect(mem.session).toBe("test-session");
  });
});

// ─── PersistentMemory ───────────────────────────────────────────────

describe("PersistentMemory", () => {
  let mem: PersistentMemory;

  beforeEach(() => {
    mem = new PersistentMemory("persistent");
  });

  it("add() creates an entry persisted to disk", () => {
    const entry = mem.add("persistent fact", "fact");
    expect(entry.id).toBeDefined();
    expect(entry.scope).toBe("persistent");
    expect(mem.size).toBe(1);

    const filePath = path.join(tmpDir, "memory", "persistent.json");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("get() retrieves by ID", () => {
    const entry = mem.add("test", "fact");
    const retrieved = mem.get(entry.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.content).toBe("test");
  });

  it("get() returns undefined for missing ID", () => {
    expect(mem.get("nonexistent")).toBeUndefined();
  });

  it("list() returns all active entries", () => {
    mem.add("fact 1", "fact");
    mem.add("fact 2", "preference");
    expect(mem.list()).toHaveLength(2);
  });

  it("delete() removes an entry", () => {
    const entry = mem.add("to delete", "fact");
    expect(mem.delete(entry.id)).toBe(true);
    expect(mem.get(entry.id)).toBeUndefined();
    expect(mem.size).toBe(0);
  });

  it("prune() moves expired entries to archive", () => {
    // Create an entry with very short TTL and old lastAccessed
    const entry = mem.add("old entry", "fact", {
      ttl: 1, // 1 second half-life
      relevanceScore: 0.1,
    });

    // Manually backdate the entry's lastAccessed via update
    const filePath = path.join(tmpDir, "memory", "persistent.json");
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const pastDate = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    raw.entries[0].lastAccessed = pastDate;
    raw.entries[0].relevanceScore = 0.05; // very low
    fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), "utf-8");

    const pruned = mem.prune({ threshold: 0.1 });
    expect(pruned).toBe(1);
    expect(mem.size).toBe(0);
    // Should be in archive
    expect(mem.list(true)).toHaveLength(1);
  });

  it("persists across instances", () => {
    mem.add("cross-instance", "fact");

    const mem2 = new PersistentMemory("persistent");
    expect(mem2.size).toBe(1);
    expect(mem2.list()[0].content).toBe("cross-instance");
  });

  it("storeScope getter returns the scope", () => {
    expect(mem.storeScope).toBe("persistent");
  });
});
