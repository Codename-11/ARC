import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  createTempArcDir,
  writeMockConfig,
} from "../fixtures/setup.js";
import { resolveProfile, loadConfig } from "@axiom-labs/arc-core";
import type { ArcConfig, Profile } from "@axiom-labs/arc-core";

let arcDir: string;
let cleanup: () => void;
let originalArcDir: string | undefined;

beforeEach(() => {
  originalArcDir = process.env["ARC_DIR"];
  const tmp = createTempArcDir();
  arcDir = tmp.arcDir;
  cleanup = tmp.cleanup;
  process.env["ARC_DIR"] = arcDir;
});

afterEach(() => {
  cleanup();
  if (originalArcDir !== undefined) {
    process.env["ARC_DIR"] = originalArcDir;
  } else {
    delete process.env["ARC_DIR"];
  }
  vi.restoreAllMocks();
});

// ─── Helpers ─────────────────────────────────────────────────────────

function writeConfigWithInheritance(
  dir: string,
  profiles: Record<string, Partial<Profile>>,
  activeProfile?: string
): ArcConfig {
  const now = new Date().toISOString();
  const entries: Record<string, unknown> = {};

  for (const [name, opts] of Object.entries(profiles)) {
    const profileDir = path.join(dir, "profiles", name);
    fs.mkdirSync(profileDir, { recursive: true });
    entries[name] = {
      configDir: profileDir,
      createdAt: now,
      ...opts,
    };
  }

  const firstKey = activeProfile ?? Object.keys(profiles)[0] ?? "default";
  const config = {
    version: 1 as const,
    activeProfile: firstKey,
    profiles: entries as Record<string, Profile>,
  };

  writeMockConfig(dir, config);
  return config;
}

// ─── Demo Scenario 1: child inherits base, overrides enforcement ─────

describe("Profile Inheritance – Demo Scenarios", () => {
  it("child (inherits:base, enforcement:advise) resolves to oauth+claude+advise", () => {
    const config = writeConfigWithInheritance(arcDir, {
      base: {
        authType: "oauth",
        tool: "claude",
        enforcement: "enforce",
      },
      child: {
        inherits: "base",
        enforcement: "advise",
      } as Partial<Profile>,
    });

    const resolved = resolveProfile(config, "child");

    expect(resolved.authType).toBe("oauth");
    expect(resolved.tool).toBe("claude");
    expect(resolved.enforcement).toBe("advise");
    expect(resolved).not.toHaveProperty("inherits");
  });

  it("config with inheritance round-trips through loadConfig", () => {
    writeConfigWithInheritance(arcDir, {
      base: {
        authType: "oauth",
        tool: "claude",
        enforcement: "enforce",
      },
      child: {
        inherits: "base",
        enforcement: "advise",
      } as Partial<Profile>,
    });

    const loaded = loadConfig();
    const resolved = resolveProfile(loaded, "child");

    expect(resolved.authType).toBe("oauth");
    expect(resolved.tool).toBe("claude");
    expect(resolved.enforcement).toBe("advise");
    expect(resolved).not.toHaveProperty("inherits");
  });

  it("circular inheritance (A→B→A) produces a clear error", () => {
    const config = writeConfigWithInheritance(arcDir, {
      a: {
        authType: "oauth",
        tool: "claude",
        inherits: "b",
      },
      b: {
        authType: "oauth",
        tool: "claude",
        inherits: "a",
      },
    });

    expect(() => resolveProfile(config, "a")).toThrow(
      /Circular profile inheritance detected: a → b → a/
    );
  });
});

// ─── Deep merge in launch context ────────────────────────────────────

describe("Profile Inheritance – Deep Merge", () => {
  it("parent envOverrides {FOO:'1'} + child envOverrides {BAR:'2'} → resolved has both", () => {
    const config = writeConfigWithInheritance(arcDir, {
      parent: {
        authType: "oauth",
        tool: "claude",
        envOverrides: { FOO: "1" },
      },
      child: {
        inherits: "parent",
        envOverrides: { BAR: "2" },
      } as Partial<Profile>,
    });

    const resolved = resolveProfile(config, "child");
    expect(resolved.envOverrides).toEqual({ FOO: "1", BAR: "2" });
  });

  it("parent hooks + child hooks → merged with both present", () => {
    const config = writeConfigWithInheritance(arcDir, {
      parent: {
        authType: "oauth",
        tool: "claude",
        hooks: {
          "risk-detection": { enabled: true, timeout: 3000 },
        },
      },
      child: {
        inherits: "parent",
        hooks: {
          "source-classify": { enabled: true, timeout: 5000 },
        },
      } as Partial<Profile>,
    });

    const resolved = resolveProfile(config, "child");
    expect(resolved.hooks!["risk-detection"]).toEqual({ enabled: true, timeout: 3000 });
    expect(resolved.hooks!["source-classify"]).toEqual({ enabled: true, timeout: 5000 });
  });

  it("child launchArgs override parent launchArgs (array replacement)", () => {
    const config = writeConfigWithInheritance(arcDir, {
      parent: {
        authType: "oauth",
        tool: "claude",
        launchArgs: ["--verbose"],
      },
      child: {
        inherits: "parent",
        launchArgs: ["--quiet"],
      } as Partial<Profile>,
    });

    const resolved = resolveProfile(config, "child");
    expect(resolved.launchArgs).toEqual(["--quiet"]);
  });
});

// ─── Launch path: handleLaunch resolves inheritance ──────────────────

describe("Profile Inheritance – Launch Pipeline", () => {
  it("handleLaunch uses resolved profile (merged envOverrides from parent+child)", async () => {
    writeConfigWithInheritance(arcDir, {
      base: {
        authType: "oauth",
        tool: "claude",
        enforcement: "enforce",
        envOverrides: { BASE_VAR: "from-base" },
      },
      child: {
        inherits: "base",
        enforcement: "advise",
        envOverrides: { CHILD_VAR: "from-child" },
      } as Partial<Profile>,
    }, "child");

    // Mock findBinary to return true so launch doesn't fail on missing binary
    const launchModule = await import("../../packages/cli/src/commands/launch.js");
    vi.spyOn(launchModule, "findBinary").mockReturnValue(true);

    // Mock the adapter to capture the profile that gets passed to launch()
    const adapterModule = await import("../../packages/cli/src/adapters/index.js");
    let capturedProfile: Profile | null = null;

    vi.spyOn(adapterModule, "getAdapter").mockReturnValue({
      name: "claude",
      launch: async (profile: Profile) => {
        capturedProfile = profile;
        throw new Error("not implemented");
      },
      terminate: async () => {},
      buildProfileEnv: async (profile: Profile) => ({
        CLAUDE_CONFIG_DIR: profile.configDir,
      }),
    } as any);

    // Mock process.exit to prevent test from exiting
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as any);

    try {
      await launchModule.handleLaunch("child", ["child"]);
    } catch (e: any) {
      // Expected: legacy spawnSync path calls process.exit
      if (!e.message.includes("process.exit")) throw e;
    }

    // The adapter's launch() received the resolved profile with merged env
    expect(capturedProfile).not.toBeNull();
    expect(capturedProfile!.enforcement).toBe("advise"); // child's override
    expect(capturedProfile!.authType).toBe("oauth"); // from base
    expect(capturedProfile!.envOverrides).toEqual({
      BASE_VAR: "from-base",
      CHILD_VAR: "from-child",
    });

    exitSpy.mockRestore();
  });

  it("handleLaunch displays error and exits on circular inheritance", async () => {
    writeConfigWithInheritance(arcDir, {
      a: {
        authType: "oauth",
        tool: "claude",
        inherits: "b",
      },
      b: {
        authType: "oauth",
        tool: "claude",
        inherits: "a",
      },
    }, "a");

    const launchModule = await import("../../packages/cli/src/commands/launch.js");

    // Capture error output
    const errorMessages: string[] = [];
    const displayModule = await import("../../packages/cli/src/display.js");
    vi.spyOn(displayModule, "error").mockImplementation((msg: string) => {
      errorMessages.push(msg);
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as any);

    try {
      await launchModule.handleLaunch("a", ["a"]);
    } catch (e: any) {
      expect(e.message).toContain("process.exit(1)");
    }

    expect(errorMessages.some((m) => m.includes("Circular profile inheritance detected"))).toBe(true);

    exitSpy.mockRestore();
  });
});

// ─── Profile show displays inherited values ──────────────────────────

describe("Profile Inheritance – Profile Show", () => {
  it("handleShow displays Inherits line and resolved enforcement", async () => {
    writeConfigWithInheritance(arcDir, {
      base: {
        authType: "oauth",
        tool: "claude",
        enforcement: "enforce",
      },
      child: {
        inherits: "base",
        enforcement: "advise",
      } as Partial<Profile>,
    }, "child");

    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      output.push(String(chunk));
      return true;
    });

    const { handleShow } = await import("../../packages/cli/src/commands/profile.js");
    await handleShow("child");

    const allOutput = output.join("");
    expect(allOutput).toContain("Inherits:    base");
    expect(allOutput).toContain("Auth Type:   oauth");
    expect(allOutput).toContain("Enforcement: advise");
  });

  it("handleShow does not display Inherits line for profiles without inheritance", async () => {
    writeConfigWithInheritance(arcDir, {
      standalone: {
        authType: "oauth",
        tool: "claude",
        enforcement: "enforce",
      },
    }, "standalone");

    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      output.push(String(chunk));
      return true;
    });

    const { handleShow } = await import("../../packages/cli/src/commands/profile.js");
    await handleShow("standalone");

    const allOutput = output.join("");
    expect(allOutput).not.toContain("Inherits:");
    expect(allOutput).toContain("Auth Type:   oauth");
    expect(allOutput).toContain("Enforcement: enforce");
  });
});
