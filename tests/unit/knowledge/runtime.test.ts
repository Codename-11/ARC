import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  estimateTokens,
  type KnowledgeContext,
  type LaunchHistoryEntry,
} from "../../../packages/core/src/knowledge/runtime.js";
import type { ArcConfig, Profile } from "../../../packages/core/src/types.js";

function sampleProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    authType: "oauth",
    tool: "claude",
    configDir: "/home/bailey/.arc/profiles/work",
    description: "Work profile",
    createdAt: "2026-04-10T12:00:00.000Z",
    useShared: true,
    enforcement: "advise",
    ...overrides,
  };
}

function sampleConfig(): ArcConfig {
  return {
    version: 1,
    activeProfile: "work",
    profiles: {
      work: sampleProfile(),
      personal: sampleProfile({
        description: "Personal",
        useShared: false,
      }),
    },
  };
}

function sampleLaunches(n = 3): LaunchHistoryEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    profile: i % 2 === 0 ? "work" : "personal",
    tool: "claude",
    mode: "default" as const,
    startedAt: `2026-04-1${i + 1}T09:00:00Z`,
    exitCode: 0,
    durationMs: 12_000 + i * 1000,
  }));
}

function baseContext(
  overrides: Partial<KnowledgeContext> = {},
): KnowledgeContext {
  const config = sampleConfig();
  return {
    config,
    recentLaunches: sampleLaunches(),
    activeProfile: config.activeProfile ? config.profiles[config.activeProfile] ?? null : null,
    arcVersion: "1.7.0",
    doctorIssues: [],
    permissionMode: "supervised",
    toolCategories: ["profile", "launch", "diagnostic", "orchestration"],
    ...overrides,
  };
}

describe("estimateTokens", () => {
  it("uses a 4 char/token heuristic", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(4000))).toBe(1000);
  });
});

describe("buildSystemPrompt", () => {
  it("produces all 6 top-level sections", () => {
    const prompt = buildSystemPrompt(baseContext());
    for (const heading of [
      "## Identity",
      "## Capabilities",
      "## ARC architecture",
      "## Key concepts",
      "## Live state",
      "## Behavior rules",
    ]) {
      expect(prompt).toContain(heading);
    }
  });

  it("embeds live state: active profile, version, permission mode", () => {
    const prompt = buildSystemPrompt(baseContext());
    expect(prompt).toContain("ARC version: 1.7.0");
    expect(prompt).toContain("Permission mode: supervised");
    expect(prompt).toContain("Active profile: work");
    expect(prompt).toContain("tool=claude");
    expect(prompt).toContain("Total profiles: 2");
  });

  it("lists up to 3 recent launches only", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      profile: "work",
      tool: "claude",
      mode: "default" as const,
      startedAt: `2026-04-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      exitCode: 0,
      durationMs: 1000,
    }));
    const prompt = buildSystemPrompt(baseContext({ recentLaunches: many }));
    // count launch bullet lines (prefixed with "  - ") inside the Live state section
    const liveSection = prompt
      .split("## Live state")[1]!
      .split("## ")[0]!;
    const bulletCount = (liveSection.match(/^  - /gm) || []).length;
    // 3 launches + 1 doctor "none" bullet
    expect(bulletCount).toBeLessThanOrEqual(5);
    expect(liveSection).toContain("2026-04-01");
    expect(liveSection).toContain("2026-04-02");
    expect(liveSection).toContain("2026-04-03");
    expect(liveSection).not.toContain("2026-04-05");
  });

  it("encodes supervised-mode behavior rules", () => {
    const prompt = buildSystemPrompt(baseContext({ permissionMode: "supervised" }));
    expect(prompt).toContain("supervised mode");
  });

  it("encodes read-only-mode behavior rules", () => {
    const prompt = buildSystemPrompt(baseContext({ permissionMode: "read-only" }));
    expect(prompt).toContain("read-only mode");
  });

  it("encodes autonomous-mode behavior rules", () => {
    const prompt = buildSystemPrompt(baseContext({ permissionMode: "autonomous" }));
    expect(prompt).toContain("autonomous mode");
  });

  it("stays within the 4000-token cap even with long doctor issues", () => {
    const hugeIssues = Array.from({ length: 500 }, (_, i) =>
      `Issue #${i}: ` + "x".repeat(400),
    );
    const prompt = buildSystemPrompt(
      baseContext({ doctorIssues: hugeIssues }),
    );
    expect(estimateTokens(prompt)).toBeLessThanOrEqual(4000);
  });

  it("truncates the doctor issue list to at most 8 items", () => {
    const issues = Array.from({ length: 20 }, (_, i) => `issue-${i}`);
    const prompt = buildSystemPrompt(baseContext({ doctorIssues: issues }));
    const liveSection = prompt
      .split("## Live state")[1]!
      .split("## ")[0]!;
    expect(liveSection).toContain("issue-0");
    expect(liveSection).toContain("issue-7");
    expect(liveSection).not.toContain("issue-8");
  });

  it("shows 'none' when there are no doctor issues", () => {
    const prompt = buildSystemPrompt(baseContext({ doctorIssues: [] }));
    const liveSection = prompt
      .split("## Live state")[1]!
      .split("## ")[0]!;
    expect(liveSection).toContain("Doctor issues:");
    expect(liveSection).toContain("- none");
  });

  it("handles a null active profile gracefully", () => {
    const cfg = sampleConfig();
    cfg.activeProfile = "";
    const prompt = buildSystemPrompt(
      baseContext({ config: cfg, activeProfile: null }),
    );
    expect(prompt).toContain("Active profile:");
    expect(prompt).toContain("tool=unknown");
    expect(prompt).toContain("auth=unknown");
  });

  it("lists provided tool categories", () => {
    const prompt = buildSystemPrompt(
      baseContext({ toolCategories: ["alpha", "beta", "gamma"] }),
    );
    expect(prompt).toContain("- alpha");
    expect(prompt).toContain("- beta");
    expect(prompt).toContain("- gamma");
  });

  it("produces a prompt roughly within the 2500-3500 token range for a typical context", () => {
    const prompt = buildSystemPrompt(baseContext());
    const tokens = estimateTokens(prompt);
    expect(tokens).toBeGreaterThan(500);
    expect(tokens).toBeLessThan(4000);
  });
});
