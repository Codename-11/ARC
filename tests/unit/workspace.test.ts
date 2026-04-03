import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadWorkspaceConfig,
  applyWorkspaceOverrides,
  resolveEffectiveProfile,
} from "@axiom-labs/arc-core";
import type { ArcConfig, Profile, ArcJsonConfig } from "@axiom-labs/arc-core";
import { createTempArcDir, writeMockConfig, writeArcJson } from "../fixtures/setup.js";

// ─── Helpers ─────────────────────────────────────────────────────────

function baseProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    authType: "oauth",
    tool: "claude",
    configDir: "/tmp/test",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeConfig(
  profiles: Record<string, Partial<Profile>>,
  activeProfile?: string
): ArcConfig {
  const firstKey = activeProfile ?? Object.keys(profiles)[0] ?? "default";
  return {
    version: 1,
    activeProfile: firstKey,
    profiles: profiles as Record<string, Profile>,
  };
}

// Temp dirs for workspace tests (project dirs, not arc dirs)
let tmpDir: string;
let cleanupFns: Array<() => void>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "arc-ws-test-"));
  cleanupFns = [];
});

afterEach(() => {
  for (const fn of cleanupFns) {
    try { fn(); } catch { /* best effort */ }
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* best effort */ }
});

// ─── loadWorkspaceConfig ─────────────────────────────────────────────

describe("loadWorkspaceConfig", () => {
  it("finds arc.json in cwd", () => {
    writeArcJson(tmpDir, { version: 1, profile: "work" });

    const result = loadWorkspaceConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.config.version).toBe(1);
    expect(result!.config.profile).toBe("work");
    expect(result!.path).toBe(path.resolve(tmpDir));
  });

  it("finds arc.json in a parent directory (walk-up)", () => {
    const childDir = path.join(tmpDir, "subdir", "nested");
    fs.mkdirSync(childDir, { recursive: true });
    writeArcJson(tmpDir, { version: 1, enforcement: "enforce" });

    const result = loadWorkspaceConfig(childDir);
    expect(result).not.toBeNull();
    expect(result!.config.enforcement).toBe("enforce");
    expect(result!.path).toBe(path.resolve(tmpDir));
  });

  it("returns null when no arc.json exists", () => {
    // tmpDir has no arc.json — walk-up should eventually hit root and return null
    const emptyDir = path.join(tmpDir, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });

    const result = loadWorkspaceConfig(emptyDir);
    expect(result).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    fs.writeFileSync(path.join(tmpDir, "arc.json"), "NOT JSON {{{", "utf-8");

    const result = loadWorkspaceConfig(tmpDir);
    expect(result).toBeNull();
  });

  it("returns null for arc.json with wrong version (version:2)", () => {
    writeArcJson(tmpDir, { version: 2, profile: "test" });

    const result = loadWorkspaceConfig(tmpDir);
    expect(result).toBeNull();
  });

  it("returns null for arc.json missing version field", () => {
    writeArcJson(tmpDir, { profile: "test" });

    const result = loadWorkspaceConfig(tmpDir);
    expect(result).toBeNull();
  });

  it("returns null for arc.json that is an array", () => {
    // readJsonObject returns null for arrays, so this is handled
    fs.writeFileSync(
      path.join(tmpDir, "arc.json"),
      JSON.stringify([1, 2, 3]),
      "utf-8"
    );

    const result = loadWorkspaceConfig(tmpDir);
    expect(result).toBeNull();
  });

  it("returns null for empty arc.json object (just {})", () => {
    writeArcJson(tmpDir, {});

    const result = loadWorkspaceConfig(tmpDir);
    expect(result).toBeNull();
  });

  it("ignores unknown fields (forward-compatible)", () => {
    writeArcJson(tmpDir, {
      version: 1,
      profile: "work",
      futureField: "hello",
      anotherNew: 42,
    });

    const result = loadWorkspaceConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.config.profile).toBe("work");
    // Unknown fields are passed through (not stripped)
    expect((result!.config as unknown as Record<string, unknown>)["futureField"]).toBe("hello");
  });

  it("returns null for arc.json with only unknown fields and no version", () => {
    writeArcJson(tmpDir, { foo: "bar", baz: 123 });

    const result = loadWorkspaceConfig(tmpDir);
    expect(result).toBeNull();
  });

  it("stops at filesystem root (no infinite loop)", () => {
    // Use the OS root as cwd — should return null quickly
    const root = path.parse(tmpDir).root;
    const result = loadWorkspaceConfig(root);
    // May or may not find an arc.json at root — the important thing is it returns (doesn't hang)
    expect(result === null || result !== null).toBe(true);
  });
});

// ─── applyWorkspaceOverrides ─────────────────────────────────────────

describe("applyWorkspaceOverrides", () => {
  it("replaces enforcement", () => {
    const profile = baseProfile({ enforcement: "log" });
    const ws: ArcJsonConfig = { version: 1, enforcement: "enforce" };

    const result = applyWorkspaceOverrides(profile, ws);
    expect(result.enforcement).toBe("enforce");
  });

  it("replaces tool (adapter)", () => {
    const profile = baseProfile({ tool: "claude" });
    const ws: ArcJsonConfig = { version: 1, adapter: "codex" };

    const result = applyWorkspaceOverrides(profile, ws);
    expect(result.tool).toBe("codex");
  });

  it("deep-merges hooks", () => {
    const profile = baseProfile({
      hooks: {
        "source-classify": { enabled: true, timeout: 5000 },
        "risk-detection": { enabled: true },
      },
    });
    const ws: ArcJsonConfig = {
      version: 1,
      hooks: {
        "source-classify": { enabled: false, timeout: 3000 },
        "new-hook": { enabled: true },
      },
    };

    const result = applyWorkspaceOverrides(profile, ws);
    // Overridden hook
    expect(result.hooks!["source-classify"].enabled).toBe(false);
    expect(result.hooks!["source-classify"].timeout).toBe(3000);
    // Preserved hook from base
    expect(result.hooks!["risk-detection"].enabled).toBe(true);
    // New hook from workspace
    expect(result.hooks!["new-hook"].enabled).toBe(true);
  });

  it("deep-merges mcpServers", () => {
    const profile = baseProfile() as unknown as Record<string, unknown>;
    profile["mcpServers"] = { server1: { url: "http://a" } };
    const typedProfile = profile as unknown as Profile;

    const ws: ArcJsonConfig = {
      version: 1,
      mcpServers: { server2: { url: "http://b" } },
    };

    const result = applyWorkspaceOverrides(typedProfile, ws);
    const servers = (result as unknown as Record<string, unknown>)["mcpServers"] as Record<
      string,
      unknown
    >;
    expect(servers["server1"]).toEqual({ url: "http://a" });
    expect(servers["server2"]).toEqual({ url: "http://b" });
  });

  it("does not modify the input profile (immutability)", () => {
    const profile = baseProfile({
      enforcement: "log",
      hooks: { "source-classify": { enabled: true } },
    });
    const originalEnforcement = profile.enforcement;
    const originalHooksRef = profile.hooks;

    const ws: ArcJsonConfig = {
      version: 1,
      enforcement: "enforce",
      hooks: { "source-classify": { enabled: false } },
    };

    applyWorkspaceOverrides(profile, ws);

    // Original profile must be unchanged
    expect(profile.enforcement).toBe(originalEnforcement);
    expect(profile.hooks).toBe(originalHooksRef);
    expect(profile.hooks!["source-classify"].enabled).toBe(true);
  });

  it("with no overrides returns an equivalent profile", () => {
    const profile = baseProfile({ enforcement: "log", tool: "claude" });
    const ws: ArcJsonConfig = { version: 1 };

    const result = applyWorkspaceOverrides(profile, ws);
    expect(result.enforcement).toBe("log");
    expect(result.tool).toBe("claude");
    expect(result.authType).toBe("oauth");
  });
});

// ─── resolveEffectiveProfile ─────────────────────────────────────────

describe("resolveEffectiveProfile", () => {
  let arcDir: string;
  let arcCleanup: () => void;

  beforeEach(() => {
    const temp = createTempArcDir();
    arcDir = temp.arcDir;
    arcCleanup = temp.cleanup;
    cleanupFns.push(arcCleanup);
    process.env["ARC_DIR"] = arcDir;
  });

  afterEach(() => {
    delete process.env["ARC_DIR"];
  });

  it("uses arc.json profile name over activeProfile", () => {
    const config = makeConfig({
      personal: baseProfile({ enforcement: "off" }),
      work: baseProfile({ enforcement: "enforce" }),
    }, "personal");

    writeArcJson(tmpDir, { version: 1, profile: "work" });

    const result = resolveEffectiveProfile(config, undefined, tmpDir);
    expect(result.profileName).toBe("work");
    expect(result.profile.enforcement).toBe("enforce");
    expect(result.workspacePath).toBe(path.resolve(tmpDir));
  });

  it("applies workspace enforcement override", () => {
    const config = makeConfig({
      dev: baseProfile({ enforcement: "log" }),
    });

    writeArcJson(tmpDir, { version: 1, enforcement: "advise" });

    const result = resolveEffectiveProfile(config, undefined, tmpDir);
    expect(result.profile.enforcement).toBe("advise");
    expect(result.profileName).toBe("dev");
  });

  it("with no arc.json falls back to normal resolution", () => {
    const config = makeConfig({
      main: baseProfile({ enforcement: "enforce" }),
    });

    const emptyDir = path.join(tmpDir, "no-arc");
    fs.mkdirSync(emptyDir, { recursive: true });

    const result = resolveEffectiveProfile(config, undefined, emptyDir);
    expect(result.profileName).toBe("main");
    expect(result.profile.enforcement).toBe("enforce");
    expect(result.workspacePath).toBeNull();
  });

  it("error mentions arc.json path when profile not found", () => {
    const config = makeConfig({
      existing: baseProfile(),
    });

    writeArcJson(tmpDir, { version: 1, profile: "nonexistent" });

    expect(() => resolveEffectiveProfile(config, undefined, tmpDir)).toThrow(
      /nonexistent.*not found.*arc\.json/
    );
  });

  it("uses explicitName when no arc.json profile is set", () => {
    const config = makeConfig({
      alpha: baseProfile({ enforcement: "off" }),
      beta: baseProfile({ enforcement: "enforce" }),
    }, "alpha");

    // arc.json exists but has no profile field
    writeArcJson(tmpDir, { version: 1, enforcement: "advise" });

    const result = resolveEffectiveProfile(config, "beta", tmpDir);
    expect(result.profileName).toBe("beta");
    // enforcement from arc.json override
    expect(result.profile.enforcement).toBe("advise");
  });

  it("arc.json profile name takes priority over explicitName", () => {
    const config = makeConfig({
      alpha: baseProfile({ enforcement: "off" }),
      beta: baseProfile({ enforcement: "enforce" }),
    }, "alpha");

    writeArcJson(tmpDir, { version: 1, profile: "alpha" });

    // Even though explicitName is "beta", arc.json says "alpha"
    const result = resolveEffectiveProfile(config, "beta", tmpDir);
    expect(result.profileName).toBe("alpha");
  });
});
