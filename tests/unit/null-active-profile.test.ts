import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  defaultConfig,
  resolveProfileName,
  getActiveProfile,
  validateConfig,
} from "../../packages/core/src/config.js";
import type { ArcConfig, Profile } from "../../packages/core/src/types.js";

// ─── Temp dir / env setup ────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-null-active-"));
  process.env["ARC_DIR"] = tmpDir;
  // Silence log output used by launch.ts when imported indirectly.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  delete process.env["ARC_DIR"];
  vi.restoreAllMocks();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

function baseProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    authType: "oauth",
    tool: "claude",
    configDir: path.join(tmpDir, "profiles", "p"),
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeConfig(
  profiles: Record<string, Profile>,
  activeProfile: string | null = null
): ArcConfig {
  return { version: 1, activeProfile, profiles };
}

// ─── 1. Null activeProfile resolution ────────────────────────────────

describe("null activeProfile resolution", () => {
  it("defaultConfig() starts with null activeProfile", () => {
    const cfg = defaultConfig();
    expect(cfg.activeProfile).toBeNull();
    expect(cfg.profiles).toEqual({});
  });

  it("getActiveProfile() returns undefined when null", () => {
    const cfg = makeConfig({}, null);
    expect(getActiveProfile(cfg)).toBeUndefined();
  });

  it("resolveProfileName() throws a clear error when null and no name", () => {
    const cfg = makeConfig({}, null);
    expect(() => resolveProfileName(cfg)).toThrow(
      /No active profile\. Use 'arc profile switch <name>' or pass --profile\./
    );
  });

  it("resolveProfileName() returns explicit name even when active is null", () => {
    const cfg = makeConfig({ work: baseProfile() }, null);
    expect(resolveProfileName(cfg, "work")).toBe("work");
  });

  it("validateConfig() accepts null activeProfile", () => {
    const cfg = {
      version: 1,
      activeProfile: null,
      profiles: {
        work: {
          authType: "oauth",
          configDir: "/tmp/work",
          createdAt: "2026-01-01T00:00:00Z",
        },
      },
    };
    expect(validateConfig(cfg)).toBe(true);
  });

  it("validateConfig() still rejects non-string, non-null activeProfile", () => {
    const cfg = {
      version: 1,
      activeProfile: 42,
      profiles: {},
    };
    expect(validateConfig(cfg)).toBe(false);
  });
});

// ─── 2. Bare mode — env isolation contract ──────────────────────────

describe("bare launch mode — env contract", () => {
  it("handleBareLaunch source code does not inject profile env vars", async () => {
    // Contract test: the bare-launch implementation must never set any of
    // the profile-specific env vars that the standard launch path injects.
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        "..",
        "..",
        "packages",
        "cli",
        "src",
        "commands",
        "launch.ts"
      ),
      "utf-8"
    );
    const bareFn = src.slice(
      src.indexOf("export async function handleBareLaunch"),
      src.indexOf("/** Suggest an install command")
    );
    expect(bareFn.length).toBeGreaterThan(0);
    // Env vars ARC injects in normal launch — must NOT appear in bare path.
    expect(bareFn).not.toContain("CLAUDE_CONFIG_DIR");
    expect(bareFn).not.toContain("GEMINI_CLI_HOME");
    expect(bareFn).not.toContain("CODEX_HOME");
    expect(bareFn).not.toContain("ARC_AGENT_INSTRUCTIONS");
    expect(bareFn).not.toContain("buildProfileEnv");
    // Must still spawn the tool with stdio inherit.
    expect(bareFn).toContain("spawnSync");
    expect(bareFn).toContain('stdio: "inherit"');
  });
});

// ─── 3. Tool-name inference (pure helper) ────────────────────────────

describe("shouldInferBare — tool-name inference", () => {
  it("infers bare when name is a known tool AND no profile matches", async () => {
    const { shouldInferBare } = await import(
      "../../packages/cli/src/commands/launch.js"
    );
    expect(shouldInferBare("claude", [], false)).toBe(true);
    expect(shouldInferBare("codex", ["work"], false)).toBe(true);
    expect(shouldInferBare("gemini", ["dev", "prod"], false)).toBe(true);
    expect(shouldInferBare("hermes", [], false)).toBe(true);
    expect(shouldInferBare("openclaw", [], false)).toBe(true);
  });

  it("does NOT infer when a profile with the tool-name exists", async () => {
    const { shouldInferBare } = await import(
      "../../packages/cli/src/commands/launch.js"
    );
    expect(shouldInferBare("claude", ["claude"], false)).toBe(false);
    expect(shouldInferBare("codex", ["codex", "work"], false)).toBe(false);
  });

  it("does NOT infer for unknown tools (avoids hijacking real profile names)", async () => {
    const { shouldInferBare } = await import(
      "../../packages/cli/src/commands/launch.js"
    );
    expect(shouldInferBare("work", [], false)).toBe(false);
    expect(shouldInferBare("random-thing", [], false)).toBe(false);
  });

  it("does NOT infer when no name is given", async () => {
    const { shouldInferBare } = await import(
      "../../packages/cli/src/commands/launch.js"
    );
    expect(shouldInferBare(undefined, [], false)).toBe(false);
  });

  it("explicit bare=true always wins, regardless of name/profile state", async () => {
    const { shouldInferBare } = await import(
      "../../packages/cli/src/commands/launch.js"
    );
    expect(shouldInferBare("work", ["work"], true)).toBe(true);
    expect(shouldInferBare(undefined, [], true)).toBe(true);
    expect(shouldInferBare("anything", [], true)).toBe(true);
  });
});
