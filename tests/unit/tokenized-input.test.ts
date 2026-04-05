import { describe, it, expect } from "vitest";
import { tokenize } from "../../packages/cli/src/tui/components/TokenizedInput.js";
import { resolveAutoComplete, applyCompletion } from "../../packages/cli/src/tui/components/AutoComplete.js";

// ─── Tokenizer ──────────────────────────────────────────────────────

describe("tokenize", () => {
  it("returns single text token for plain input", () => {
    expect(tokenize("hello world")).toEqual([
      { type: "text", value: "hello world" },
    ]);
  });

  it("recognizes /command at start", () => {
    expect(tokenize("/launch")).toEqual([
      { type: "command", value: "/launch" },
    ]);
  });

  it("recognizes /command with trailing text", () => {
    expect(tokenize("/launch work")).toEqual([
      { type: "command", value: "/launch" },
      { type: "text", value: " work" },
    ]);
  });

  it("recognizes @mention", () => {
    expect(tokenize("hello @work")).toEqual([
      { type: "text", value: "hello " },
      { type: "mention", value: "@work" },
    ]);
  });

  it("recognizes #tag", () => {
    expect(tokenize("#urgent fix this")).toEqual([
      { type: "tag", value: "#urgent" },
      { type: "text", value: " fix this" },
    ]);
  });

  it("handles multiple token types", () => {
    expect(tokenize("/switch @personal #now")).toEqual([
      { type: "command", value: "/switch" },
      { type: "text", value: " " },
      { type: "mention", value: "@personal" },
      { type: "text", value: " " },
      { type: "tag", value: "#now" },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});

// ─── AutoComplete resolution ────────────────────────────────────────

const profiles = ["work", "personal", "work-staging"];

describe("resolveAutoComplete", () => {
  it("returns null for empty input", () => {
    expect(resolveAutoComplete("", profiles)).toBeNull();
  });

  it("suggests commands for / prefix", () => {
    const result = resolveAutoComplete("/la", profiles);
    expect(result).not.toBeNull();
    expect(result!.suggestions[0]!.value).toBe("/launch");
  });

  it("suggests all commands for bare /", () => {
    const result = resolveAutoComplete("/", profiles);
    expect(result).not.toBeNull();
    expect(result!.suggestions.length).toBeGreaterThan(5);
  });

  it("suggests profiles after /launch ", () => {
    const result = resolveAutoComplete("/launch ", profiles);
    expect(result).not.toBeNull();
    expect(result!.suggestions.map((s) => s.value)).toContain("work");
    expect(result!.suggestions.map((s) => s.value)).toContain("personal");
  });

  it("filters profiles after /launch wo", () => {
    const result = resolveAutoComplete("/launch wo", profiles);
    expect(result).not.toBeNull();
    expect(result!.suggestions.map((s) => s.value)).toContain("work");
    expect(result!.suggestions.map((s) => s.value)).toContain("work-staging");
    expect(result!.suggestions.map((s) => s.value)).not.toContain("personal");
  });

  it("suggests profiles for @mention", () => {
    const result = resolveAutoComplete("hello @wo", profiles);
    expect(result).not.toBeNull();
    expect(result!.suggestions[0]!.value).toBe("@work");
  });

  it("returns null for non-matching input", () => {
    expect(resolveAutoComplete("git status", profiles)).toBeNull();
  });

  it("returns null when command fully typed with no more matches", () => {
    const result = resolveAutoComplete("/clear", profiles);
    expect(result).toBeNull(); // exact match, no more suggestions
  });
});

// ─── Apply completion ───────────────────────────────────────────────

describe("applyCompletion", () => {
  it("replaces partial command", () => {
    const state = resolveAutoComplete("/la", profiles)!;
    expect(applyCompletion("/la", state)).toBe("/launch ");
  });

  it("replaces partial profile after /launch", () => {
    const state = resolveAutoComplete("/launch pe", profiles)!;
    expect(applyCompletion("/launch pe", state)).toBe("/launch personal");
  });

  it("replaces @mention", () => {
    const state = resolveAutoComplete("hello @wo", profiles)!;
    expect(applyCompletion("hello @wo", state)).toBe("hello @work");
  });
});
