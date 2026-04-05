import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PersistentMemory } from "../../packages/core/src/memory/persistent-memory.js";
import { searchMemories } from "../../packages/core/src/memory/relevance.js";

// Suppress log I/O during tests
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

// ─── Temp dir setup ─────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-cli-memory-test-"));
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

// ─── Helper to seed memory entries ──────────────────────────────────

function seedMemory(scope: "session" | "persistent" | "team" = "persistent") {
  const mem = new PersistentMemory(scope);
  mem.add("User prefers dark mode", "preference", { tags: ["ui", "theme"] });
  mem.add("Project uses TypeScript strict mode", "fact", { tags: ["typescript", "config"] });
  mem.add("Always run tests before committing", "pattern", { tags: ["workflow"] });
  return mem;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("CLI memory: PersistentMemory operations", () => {
  // ── list ──────────────────────────────────────────────────────

  describe("list()", () => {
    it("returns empty when store has no memories", () => {
      const mem = new PersistentMemory("persistent");
      expect(mem.list()).toEqual([]);
    });

    it("returns all entries after seeding", () => {
      seedMemory();
      const mem = new PersistentMemory("persistent");
      const entries = mem.list();
      expect(entries.length).toBeGreaterThanOrEqual(3);
      expect(entries.some((e) => e.content.includes("dark mode"))).toBe(true);
    });

    it("entries have expected properties", () => {
      seedMemory();
      const mem = new PersistentMemory("persistent");
      const entries = mem.list();
      expect(entries[0]).toHaveProperty("content");
      expect(entries[0]).toHaveProperty("type");
      expect(entries[0]).toHaveProperty("scope");
    });

    it("filters by type via manual filtering", () => {
      seedMemory();
      const mem = new PersistentMemory("persistent");
      const entries = mem.list().filter((e) => e.type === "preference");
      expect(entries.every((e) => e.type === "preference")).toBe(true);
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });

    it("respects limit via slicing", () => {
      seedMemory();
      const mem = new PersistentMemory("persistent");
      const entries = mem.list().slice(0, 1);
      expect(entries).toHaveLength(1);
    });

    it("lists specific scope", () => {
      seedMemory("session");
      const mem = new PersistentMemory("session");
      const entries = mem.list();
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries.every((e) => e.scope === "session")).toBe(true);
    });
  });

  // ── search ────────────────────────────────────────────────────

  describe("search()", () => {
    it("returns matching results for keyword search", () => {
      seedMemory();
      const mem = new PersistentMemory("persistent");
      const results = mem.search("dark mode");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((e) => e.content.includes("dark mode"))).toBe(true);
    });

    it("returns empty array for unmatched query", () => {
      seedMemory();
      const mem = new PersistentMemory("persistent");
      const results = mem.search("zzz_nonexistent_xxy");
      expect(results).toHaveLength(0);
    });

    it("searchMemories utility works on raw entries", () => {
      seedMemory();
      const mem = new PersistentMemory("persistent");
      const entries = mem.list();
      const results = searchMemories("typescript", entries);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty array for empty query", () => {
      seedMemory();
      const mem = new PersistentMemory("persistent");
      const results = searchMemories("", mem.list());
      expect(results).toHaveLength(0);
    });
  });

  // ── stats / counts ────────────────────────────────────────────

  describe("size and counts", () => {
    it("reports correct size after seeding", () => {
      seedMemory("persistent");
      seedMemory("session");
      const pMem = new PersistentMemory("persistent");
      const sMem = new PersistentMemory("session");
      expect(pMem.size).toBe(3);
      expect(sMem.size).toBe(3);
    });

    it("size is 0 when empty", () => {
      const mem = new PersistentMemory("persistent");
      expect(mem.size).toBe(0);
    });
  });

  // ── prune ─────────────────────────────────────────────────────

  describe("prune()", () => {
    it("returns 0 when store is empty", () => {
      const mem = new PersistentMemory("persistent");
      const pruned = mem.prune({ threshold: 0.5 });
      expect(pruned).toBe(0);
    });

    it("prunes entries below threshold", () => {
      const mem = new PersistentMemory("persistent");
      mem.add("Low relevance entry", "fact", { relevanceScore: 0.01 });

      // Backdate to ensure decay
      const filePath = path.join(tmpDir, "memory", "persistent.json");
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      raw.entries[0].lastAccessed = new Date(Date.now() - 60_000).toISOString();
      raw.entries[0].relevanceScore = 0.05;
      fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), "utf-8");

      const mem2 = new PersistentMemory("persistent");
      const pruned = mem2.prune({ threshold: 0.5 });
      expect(pruned).toBe(1);
    });

    it("does not prune entries above threshold", () => {
      seedMemory(); // seeds entries with default relevanceScore of 0.8
      const mem = new PersistentMemory("persistent");
      const pruned = mem.prune({ threshold: 0.01 });
      expect(pruned).toBe(0);
    });
  });
});
