import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ToolRegistry,
  registerArcTools,
  ARC_TOOLS,
} from "../../../packages/core/src/agent/index.js";
import type {
  ToolContext,
} from "../../../packages/core/src/agent/types.js";
import type { ArcConfig, Profile } from "../../../packages/core/src/types.js";

// Don't silence logging — writeLogEvent writes under ARC_DIR which we control.

function baseProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    authType: "oauth",
    tool: "claude",
    configDir: "/tmp/fake-does-not-exist",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function writeConfig(dir: string, cfg: ArcConfig): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(cfg, null, 2), "utf-8");
}

function makeCtx(mode: "read-only" | "supervised" | "autonomous" = "autonomous"): ToolContext {
  return {
    mode,
    confirm: vi.fn(async () => true),
    log: vi.fn(),
  };
}

let tmpDir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-agent-test-"));
  prevEnv = process.env["ARC_DIR"];
  process.env["ARC_DIR"] = tmpDir;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env["ARC_DIR"];
  else process.env["ARC_DIR"] = prevEnv;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("registerArcTools", () => {
  it("registers all Phase 2 tools (≥15)", () => {
    const registry = new ToolRegistry();
    registerArcTools(registry);
    const list = registry.list();
    expect(list.length).toBeGreaterThanOrEqual(15);
  });

  it("includes read, write, and dangerous tiers", () => {
    const registry = new ToolRegistry();
    registerArcTools(registry);
    const tiers = new Set(registry.list().map((t) => t.permission));
    expect(tiers.has("read")).toBe(true);
    expect(tiers.has("write")).toBe(true);
    expect(tiers.has("dangerous")).toBe(true);
  });

  it("read-only mode hides write/dangerous tools", () => {
    const registry = new ToolRegistry();
    registerArcTools(registry);
    const schemas = registry.getSchemas("read-only");
    for (const s of schemas) {
      expect(s.permission).toBe("read");
    }
  });
});

describe("list_profiles tool", () => {
  it("returns the profiles from the temp config", async () => {
    const cfg: ArcConfig = {
      version: 1,
      activeProfile: "alpha",
      profiles: {
        alpha: baseProfile({ description: "the alpha profile" }),
        beta: baseProfile({ tool: "gemini" }),
      },
    };
    writeConfig(tmpDir, cfg);

    const registry = new ToolRegistry();
    registerArcTools(registry);
    const result = await registry.execute("list_profiles", {}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const profiles = result.output as Array<{ name: string }>;
      const names = profiles.map((p) => p.name).sort();
      expect(names).toEqual(["alpha", "beta"]);
    }
  });

  it("returns empty when no config exists yet", async () => {
    const registry = new ToolRegistry();
    registerArcTools(registry);
    const result = await registry.execute("list_profiles", {}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toEqual([]);
  });
});

describe("show_profile tool", () => {
  it("returns the profile record", async () => {
    writeConfig(tmpDir, {
      version: 1,
      activeProfile: "alpha",
      profiles: { alpha: baseProfile({ description: "desc" }) },
    });
    const registry = new ToolRegistry();
    registerArcTools(registry);
    const result = await registry.execute("show_profile", { name: "alpha" }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const prof = result.output as { name: string; description?: string };
      expect(prof.name).toBe("alpha");
      expect(prof.description).toBe("desc");
    }
  });

  it("errors when profile is missing", async () => {
    writeConfig(tmpDir, {
      version: 1,
      activeProfile: "alpha",
      profiles: { alpha: baseProfile() },
    });
    const registry = new ToolRegistry();
    registerArcTools(registry);
    const result = await registry.execute("show_profile", { name: "ghost" }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/);
  });
});

describe("get_active_profile tool", () => {
  it("returns active profile record", async () => {
    writeConfig(tmpDir, {
      version: 1,
      activeProfile: "alpha",
      profiles: { alpha: baseProfile() },
    });
    const registry = new ToolRegistry();
    registerArcTools(registry);
    const result = await registry.execute("get_active_profile", {}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const prof = result.output as { name: string } | null;
      expect(prof?.name).toBe("alpha");
    }
  });
});

describe("switch_active_profile tool", () => {
  it("writes the new active profile to config", async () => {
    writeConfig(tmpDir, {
      version: 1,
      activeProfile: "alpha",
      profiles: {
        alpha: baseProfile(),
        beta: baseProfile(),
      },
    });
    const registry = new ToolRegistry();
    registerArcTools(registry);
    const result = await registry.execute(
      "switch_active_profile",
      { name: "beta" },
      makeCtx("autonomous"),
    );
    expect(result.ok).toBe(true);
    const written = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "config.json"), "utf-8"),
    ) as ArcConfig;
    expect(written.activeProfile).toBe("beta");
  });

  it("is blocked in read-only mode", async () => {
    writeConfig(tmpDir, {
      version: 1,
      activeProfile: "alpha",
      profiles: { alpha: baseProfile(), beta: baseProfile() },
    });
    const registry = new ToolRegistry();
    registerArcTools(registry);
    const result = await registry.execute(
      "switch_active_profile",
      { name: "beta" },
      makeCtx("read-only"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blocked).toBe(true);
  });
});

describe("set_profile_flags tool", () => {
  it("replaces launchArgs array", async () => {
    writeConfig(tmpDir, {
      version: 1,
      activeProfile: "alpha",
      profiles: { alpha: baseProfile() },
    });
    const registry = new ToolRegistry();
    registerArcTools(registry);
    const result = await registry.execute(
      "set_profile_flags",
      { profileName: "alpha", flags: ["--verbose", "--no-color"] },
      makeCtx("autonomous"),
    );
    expect(result.ok).toBe(true);
    const written = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "config.json"), "utf-8"),
    ) as ArcConfig;
    expect(written.profiles["alpha"].launchArgs).toEqual(["--verbose", "--no-color"]);
  });
});

describe("delete_profile tool", () => {
  it("removes the profile from config (dangerous tier)", async () => {
    writeConfig(tmpDir, {
      version: 1,
      activeProfile: "alpha",
      profiles: {
        alpha: baseProfile(),
        beta: baseProfile(),
      },
    });
    const registry = new ToolRegistry();
    registerArcTools(registry);
    const result = await registry.execute(
      "delete_profile",
      { name: "beta" },
      makeCtx("autonomous"),
    );
    expect(result.ok).toBe(true);
    const written = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "config.json"), "utf-8"),
    ) as ArcConfig;
    expect(written.profiles["beta"]).toBeUndefined();
    expect(written.profiles["alpha"]).toBeDefined();
  });

  it("requires confirmation in supervised mode", async () => {
    writeConfig(tmpDir, {
      version: 1,
      activeProfile: "alpha",
      profiles: { alpha: baseProfile(), beta: baseProfile() },
    });
    const registry = new ToolRegistry();
    registerArcTools(registry);
    const confirm = vi.fn(async () => false);
    const result = await registry.execute(
      "delete_profile",
      { name: "beta" },
      { mode: "supervised", confirm, log: () => {} },
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blocked).toBe(true);
  });
});

describe("get_arc_version tool", () => {
  it("returns a version string", async () => {
    const registry = new ToolRegistry();
    registerArcTools(registry);
    const result = await registry.execute("get_arc_version", {}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const out = result.output as { version: string };
      expect(typeof out.version).toBe("string");
    }
  });
});

describe("ARC_TOOLS catalog", () => {
  it("exposes every registered tool by key", () => {
    const registry = new ToolRegistry();
    registerArcTools(registry);
    for (const [key, tool] of Object.entries(ARC_TOOLS)) {
      expect(registry.get(key)?.name).toBe(tool.name);
    }
  });
});
