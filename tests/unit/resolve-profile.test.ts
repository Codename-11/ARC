import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveProfile, validateConfig, resolveInstructions } from "@axiom-labs/arc-core";
import type { ArcConfig, Profile } from "@axiom-labs/arc-core";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeConfig(
  profiles: Record<string, Partial<Profile>>
): ArcConfig {
  const firstKey = Object.keys(profiles)[0] ?? "default";
  return {
    version: 1,
    activeProfile: firstKey,
    profiles: profiles as Record<string, Profile>,
  };
}

function baseProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    authType: "oauth",
    tool: "claude",
    configDir: "/tmp/base",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("resolveProfile", () => {
  it("resolves a profile with no inheritance (identity)", () => {
    const config = makeConfig({
      standalone: baseProfile({ enforcement: "enforce" }),
    });

    const resolved = resolveProfile(config, "standalone");
    expect(resolved.authType).toBe("oauth");
    expect(resolved.tool).toBe("claude");
    expect(resolved.enforcement).toBe("enforce");
    expect(resolved).not.toHaveProperty("inherits");
  });

  it("simple inheritance: child overrides enforcement from base", () => {
    const config = makeConfig({
      base: baseProfile({ enforcement: "enforce" }),
      child: {
        inherits: "base",
        enforcement: "advise",
      } as unknown as Profile,
    });

    const resolved = resolveProfile(config, "child");
    expect(resolved.authType).toBe("oauth");
    expect(resolved.tool).toBe("claude");
    expect(resolved.configDir).toBe("/tmp/base");
    expect(resolved.enforcement).toBe("advise");
    expect(resolved).not.toHaveProperty("inherits");
  });

  it("multi-level: grandparent → parent → child merges correctly", () => {
    const config = makeConfig({
      grandparent: baseProfile({ enforcement: "off", description: "gp" }),
      parent: {
        inherits: "grandparent",
        enforcement: "log",
        description: "parent",
      } as unknown as Profile,
      child: {
        inherits: "parent",
        enforcement: "enforce",
      } as unknown as Profile,
    });

    const resolved = resolveProfile(config, "child");
    expect(resolved.authType).toBe("oauth");
    expect(resolved.enforcement).toBe("enforce");
    expect(resolved.description).toBe("parent"); // from parent, not grandparent
    expect(resolved.configDir).toBe("/tmp/base"); // from grandparent
  });

  it("deep merges hooks: parent hook A + child hook B → both present", () => {
    const config = makeConfig({
      base: baseProfile({
        hooks: {
          "hook-a": { enabled: true, timeout: 3000 },
        },
      }),
      child: {
        inherits: "base",
        hooks: {
          "hook-b": { enabled: true, timeout: 5000 },
        },
      } as unknown as Profile,
    });

    const resolved = resolveProfile(config, "child");
    expect(resolved.hooks).toBeDefined();
    expect(resolved.hooks!["hook-a"]).toEqual({ enabled: true, timeout: 3000 });
    expect(resolved.hooks!["hook-b"]).toEqual({ enabled: true, timeout: 5000 });
  });

  it("deep merges envOverrides: parent has KEY_A, child adds KEY_B → both present", () => {
    const config = makeConfig({
      base: baseProfile({
        envOverrides: { KEY_A: "a" },
      }),
      child: {
        inherits: "base",
        envOverrides: { KEY_B: "b" },
      } as unknown as Profile,
    });

    const resolved = resolveProfile(config, "child");
    expect(resolved.envOverrides).toEqual({ KEY_A: "a", KEY_B: "b" });
  });

  it("array replacement: child launchArgs override parent launchArgs", () => {
    const config = makeConfig({
      base: baseProfile({ launchArgs: ["--verbose"] }),
      child: {
        inherits: "base",
        launchArgs: ["--quiet"],
      } as unknown as Profile,
    });

    const resolved = resolveProfile(config, "child");
    expect(resolved.launchArgs).toEqual(["--quiet"]);
  });

  it("sparse child: inherits + enforcement only → resolved has parent's required fields", () => {
    const config = makeConfig({
      base: baseProfile(),
      child: {
        inherits: "base",
        enforcement: "advise",
      } as unknown as Profile,
    });

    const resolved = resolveProfile(config, "child");
    expect(resolved.authType).toBe("oauth");
    expect(resolved.configDir).toBe("/tmp/base");
    expect(resolved.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(resolved.enforcement).toBe("advise");
  });
});

describe("resolveProfile – error cases", () => {
  it("circular inheritance A→B→A produces descriptive error", () => {
    const config = makeConfig({
      a: {
        ...baseProfile(),
        inherits: "b",
      },
      b: {
        ...baseProfile(),
        inherits: "a",
      },
    });

    expect(() => resolveProfile(config, "a")).toThrow(
      /Circular profile inheritance detected: a → b → a/
    );
  });

  it("self-referencing profile produces error", () => {
    const config = makeConfig({
      self: {
        ...baseProfile(),
        inherits: "self",
      },
    });

    expect(() => resolveProfile(config, "self")).toThrow(
      /Circular profile inheritance detected: self → self/
    );
  });

  it("missing parent profile produces error", () => {
    const config = makeConfig({
      child: {
        inherits: "nonexistent",
        enforcement: "advise",
      } as unknown as Profile,
    });

    expect(() => resolveProfile(config, "child")).toThrow(
      /Profile 'nonexistent' \(inherited by 'child'\) not found/
    );
  });

  it("missing root profile produces error", () => {
    expect(() => {
      const config = makeConfig({});
      resolveProfile(config, "ghost");
    }).toThrow(/Profile 'ghost' not found/);
  });

  it("chain exceeding depth 10 produces error", () => {
    const profiles: Record<string, Partial<Profile>> = {};

    // Create chain: p0 → p1 → ... → p10 (11 profiles, depth limit exceeded)
    for (let i = 0; i <= 10; i++) {
      if (i === 10) {
        profiles[`p${i}`] = baseProfile();
      } else {
        profiles[`p${i}`] = {
          inherits: `p${i + 1}`,
          enforcement: "advise",
        };
      }
    }

    const config = makeConfig(profiles);
    expect(() => resolveProfile(config, "p0")).toThrow(
      /Profile inheritance chain exceeds maximum depth \(10\)/
    );
  });

  it("resolved profile missing required fields after merge produces error", () => {
    // Create a chain where the root has no authType either
    const config: ArcConfig = {
      version: 1,
      activeProfile: "child",
      profiles: {
        base: {
          configDir: "/tmp/base",
          createdAt: "2026-01-01T00:00:00Z",
        } as unknown as Profile,
        child: {
          inherits: "base",
          enforcement: "advise",
        } as unknown as Profile,
      },
    };

    expect(() => resolveProfile(config, "child")).toThrow(
      /Resolved profile 'child' is missing required field 'authType'/
    );
  });
});

describe("validateConfig with inherits", () => {
  it("accepts sparse child profile with inherits field", () => {
    const config = {
      version: 1,
      activeProfile: "base",
      profiles: {
        base: {
          authType: "oauth",
          configDir: "/tmp/base",
          createdAt: "2026-01-01T00:00:00Z",
        },
        child: {
          inherits: "base",
          enforcement: "advise",
        },
      },
    };

    expect(validateConfig(config)).toBe(true);
  });

  it("rejects profiles without inherits that lack required fields", () => {
    const config = {
      version: 1,
      activeProfile: "bad",
      profiles: {
        bad: {
          enforcement: "advise",
        },
      },
    };

    expect(validateConfig(config)).toBe(false);
  });

  it("rejects profile with non-string inherits", () => {
    const config = {
      version: 1,
      activeProfile: "base",
      profiles: {
        base: {
          authType: "oauth",
          configDir: "/tmp/base",
          createdAt: "2026-01-01T00:00:00Z",
        },
        child: {
          inherits: 42,
          enforcement: "advise",
        },
      },
    };

    expect(validateConfig(config)).toBe(false);
  });

  it("still validates full profiles without inherits normally", () => {
    const config = {
      version: 1,
      activeProfile: "standard",
      profiles: {
        standard: {
          authType: "oauth",
          configDir: "/tmp/test",
          createdAt: "2026-01-01T00:00:00Z",
        },
      },
    };

    expect(validateConfig(config)).toBe(true);
  });
});

// ─── resolveInstructions ────────────────────────────────────────────

describe("resolveInstructions", () => {
  it("returns undefined when no instructions configured", () => {
    const profile = baseProfile();
    expect(resolveInstructions(profile)).toBeUndefined();
  });

  it("returns inline instructions text", () => {
    const profile = baseProfile({ instructions: "You are a helpful assistant." });
    expect(resolveInstructions(profile)).toBe("You are a helpful assistant.");
  });

  it("reads instructionsFile from disk", () => {
    const tmpFile = path.join(os.tmpdir(), `arc-test-instructions-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, "Instructions from file.", "utf-8");
    try {
      const profile = baseProfile({ instructionsFile: tmpFile });
      expect(resolveInstructions(profile)).toBe("Instructions from file.");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("instructionsFile takes precedence over inline instructions", () => {
    const tmpFile = path.join(os.tmpdir(), `arc-test-instructions-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, "File wins.", "utf-8");
    try {
      const profile = baseProfile({
        instructions: "Inline text.",
        instructionsFile: tmpFile,
      });
      expect(resolveInstructions(profile)).toBe("File wins.");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("falls back to inline if instructionsFile is missing", () => {
    const profile = baseProfile({
      instructions: "Fallback text.",
      instructionsFile: "/nonexistent/path/instructions.md",
    });
    expect(resolveInstructions(profile)).toBe("Fallback text.");
  });
});
