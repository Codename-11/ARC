import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createTempArcDir,
  writeMockConfig,
  writeArcJson,
} from "../fixtures/setup.js";
import {
  resolveEffectiveProfile,
  resolveProfile,
  loadWorkspaceConfig,
} from "@axiom-labs/arc-core";
import type { ArcConfig, Profile } from "@axiom-labs/arc-core";
import { handleWhich } from "../../packages/cli/src/commands/which.js";

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

function writeConfigWithProfiles(
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

function createProjectDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-project-"));
  return dir;
}

// ─── Integration Tests ──────────────────────────────────────────────

describe("workspace integration: resolveEffectiveProfile", () => {
  it("arc.json profile override selects a different profile", () => {
    const config = writeConfigWithProfiles(arcDir, {
      default: { authType: "oauth", tool: "claude" },
      work: { authType: "api-key", tool: "gemini" },
    }, "default");

    const projectDir = createProjectDir();
    try {
      writeArcJson(projectDir, { version: 1, profile: "work" });

      const result = resolveEffectiveProfile(config, undefined, projectDir);

      expect(result.profileName).toBe("work");
      expect(result.profile.authType).toBe("api-key");
      expect(result.profile.tool).toBe("gemini");
      expect(result.workspacePath).toBe(projectDir);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("arc.json enforcement override replaces profile enforcement", () => {
    const config = writeConfigWithProfiles(arcDir, {
      default: { authType: "oauth", tool: "claude", enforcement: "enforce" },
    }, "default");

    const projectDir = createProjectDir();
    try {
      writeArcJson(projectDir, { version: 1, enforcement: "advise" });

      const result = resolveEffectiveProfile(config, undefined, projectDir);

      expect(result.profileName).toBe("default");
      expect(result.profile.enforcement).toBe("advise");
      expect(result.workspacePath).toBe(projectDir);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("arc.json with inheritance: selects child profile and resolves full chain", () => {
    const config = writeConfigWithProfiles(arcDir, {
      base: {
        authType: "oauth",
        tool: "claude",
        enforcement: "log",
      },
      child: {
        inherits: "base",
        tool: "gemini",
      } as Partial<Profile>,
    }, "base");

    const projectDir = createProjectDir();
    try {
      // arc.json selects the child profile
      writeArcJson(projectDir, { version: 1, profile: "child" });

      const result = resolveEffectiveProfile(config, undefined, projectDir);

      // Should be child profile with inheritance from base resolved
      expect(result.profileName).toBe("child");
      expect(result.profile.tool).toBe("gemini"); // child override
      expect(result.profile.authType).toBe("oauth"); // inherited from base
      expect(result.profile.enforcement).toBe("log"); // inherited from base
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("arc.json with inheritance + workspace enforcement override", () => {
    const config = writeConfigWithProfiles(arcDir, {
      base: {
        authType: "oauth",
        tool: "claude",
        enforcement: "enforce",
      },
      child: {
        inherits: "base",
        tool: "gemini",
      } as Partial<Profile>,
    }, "base");

    const projectDir = createProjectDir();
    try {
      writeArcJson(projectDir, {
        version: 1,
        profile: "child",
        enforcement: "advise",
      });

      const result = resolveEffectiveProfile(config, undefined, projectDir);

      expect(result.profileName).toBe("child");
      expect(result.profile.tool).toBe("gemini"); // from child
      expect(result.profile.authType).toBe("oauth"); // from base
      expect(result.profile.enforcement).toBe("advise"); // workspace override
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("no arc.json: falls back to normal profile resolution", () => {
    const config = writeConfigWithProfiles(arcDir, {
      default: { authType: "oauth", tool: "claude" },
      work: { authType: "api-key", tool: "gemini" },
    }, "default");

    // Use a directory with no arc.json (os temp root)
    const projectDir = createProjectDir();
    try {
      // No writeArcJson — no arc.json present
      const result = resolveEffectiveProfile(config, undefined, projectDir);

      expect(result.profileName).toBe("default");
      expect(result.profile.authType).toBe("oauth");
      expect(result.workspacePath).toBeNull();
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("no arc.json with explicit name: uses explicit name", () => {
    const config = writeConfigWithProfiles(arcDir, {
      default: { authType: "oauth", tool: "claude" },
      work: { authType: "api-key", tool: "gemini" },
    }, "default");

    const projectDir = createProjectDir();
    try {
      const result = resolveEffectiveProfile(config, "work", projectDir);

      expect(result.profileName).toBe("work");
      expect(result.profile.authType).toBe("api-key");
      expect(result.workspacePath).toBeNull();
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("invalid arc.json: graceful fallback to normal resolution", () => {
    const config = writeConfigWithProfiles(arcDir, {
      default: { authType: "oauth", tool: "claude" },
    }, "default");

    const projectDir = createProjectDir();
    try {
      // Write invalid arc.json (missing version)
      fs.writeFileSync(
        path.join(projectDir, "arc.json"),
        JSON.stringify({ profile: "nonexistent" }, null, 2),
        "utf-8"
      );

      const result = resolveEffectiveProfile(config, undefined, projectDir);

      // Should fall back to activeProfile since arc.json is invalid
      expect(result.profileName).toBe("default");
      expect(result.profile.authType).toBe("oauth");
      expect(result.workspacePath).toBeNull();
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("arc.json referencing nonexistent profile throws descriptive error", () => {
    const config = writeConfigWithProfiles(arcDir, {
      default: { authType: "oauth", tool: "claude" },
    }, "default");

    const projectDir = createProjectDir();
    try {
      writeArcJson(projectDir, { version: 1, profile: "nonexistent" });

      expect(() =>
        resolveEffectiveProfile(config, undefined, projectDir)
      ).toThrow(/nonexistent.*not found.*arc\.json/i);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("arc.json adapter override changes the resolved tool", () => {
    const config = writeConfigWithProfiles(arcDir, {
      default: { authType: "oauth", tool: "claude" },
    }, "default");

    const projectDir = createProjectDir();
    try {
      writeArcJson(projectDir, { version: 1, adapter: "codex" });

      const result = resolveEffectiveProfile(config, undefined, projectDir);

      expect(result.profileName).toBe("default");
      expect(result.profile.tool).toBe("codex"); // workspace override
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("arc.json profile takes priority over explicit name argument", () => {
    const config = writeConfigWithProfiles(arcDir, {
      default: { authType: "oauth", tool: "claude" },
      work: { authType: "api-key", tool: "gemini" },
      personal: { authType: "oauth", tool: "claude" },
    }, "default");

    const projectDir = createProjectDir();
    try {
      // arc.json says "work", but caller passes "personal" as explicit
      writeArcJson(projectDir, { version: 1, profile: "work" });

      const result = resolveEffectiveProfile(config, "personal", projectDir);

      // arc.json wins
      expect(result.profileName).toBe("work");
      expect(result.profile.tool).toBe("gemini");
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

// ─── arc which Integration Tests ────────────────────────────────────

describe("arc which command", () => {
  let stdoutOutput: string;
  let originalWrite: typeof process.stdout.write;
  let originalCwd: typeof process.cwd;

  beforeEach(() => {
    stdoutOutput = "";
    originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutOutput += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    }) as typeof process.stdout.write;
    originalCwd = process.cwd;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
  });

  it("arc which with arc.json: shows profile name with arc.json source path", async () => {
    writeConfigWithProfiles(arcDir, {
      default: { authType: "oauth", tool: "claude" },
      work: { authType: "api-key", tool: "gemini" },
    }, "default");

    const projectDir = createProjectDir();
    try {
      writeArcJson(projectDir, { version: 1, profile: "work" });
      process.cwd = () => projectDir;

      await handleWhich();

      expect(stdoutOutput).toContain("Profile:");
      expect(stdoutOutput).toContain("work");
      expect(stdoutOutput).toContain("from arc.json at");
      expect(stdoutOutput).toContain(projectDir);
      expect(stdoutOutput).toContain("Tool:        gemini");
      expect(stdoutOutput).toContain("Auth Type:   api-key");
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("arc which without arc.json: shows active profile with no arc.json found", async () => {
    writeConfigWithProfiles(arcDir, {
      default: { authType: "oauth", tool: "claude", enforcement: "log" },
    }, "default");

    const projectDir = createProjectDir();
    try {
      // No arc.json written
      process.cwd = () => projectDir;

      await handleWhich();

      expect(stdoutOutput).toContain("Profile:");
      expect(stdoutOutput).toContain("default");
      expect(stdoutOutput).toContain("active profile");
      expect(stdoutOutput).toContain("no arc.json found");
      expect(stdoutOutput).toContain("Tool:        claude");
      expect(stdoutOutput).toContain("Enforcement: log");
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("arc which with inheritance + arc.json: shows Inherits line", async () => {
    writeConfigWithProfiles(arcDir, {
      base: { authType: "oauth", tool: "claude", enforcement: "log" },
      child: { inherits: "base", tool: "gemini" } as Partial<Profile>,
    }, "base");

    const projectDir = createProjectDir();
    try {
      writeArcJson(projectDir, { version: 1, profile: "child" });
      process.cwd = () => projectDir;

      await handleWhich();

      expect(stdoutOutput).toContain("Profile:");
      expect(stdoutOutput).toContain("child");
      expect(stdoutOutput).toContain("Inherits:    base");
      expect(stdoutOutput).toContain("Tool:        gemini");
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("arc which with enforcement override: shows overridden by arc.json annotation", async () => {
    writeConfigWithProfiles(arcDir, {
      default: { authType: "oauth", tool: "claude", enforcement: "enforce" },
    }, "default");

    const projectDir = createProjectDir();
    try {
      writeArcJson(projectDir, { version: 1, enforcement: "advise" });
      process.cwd = () => projectDir;

      await handleWhich();

      expect(stdoutOutput).toContain("Enforcement: advise (overridden by arc.json)");
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
