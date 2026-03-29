import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  createTempArcDir,
  writeMockConfig,
  writeMockConfigWithProfiles,
} from "../fixtures/setup.js";

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
});

describe("Profile CRUD", () => {
  it("loadConfig returns default config when no config.json exists", async () => {
    // Dynamic import to pick up ARC_DIR env
    const { loadConfig } = await import("../../src/config.js");
    const config = loadConfig();
    expect(config.version).toBe(1);
    expect(config.activeProfile).toBe("default");
    expect(config.profiles).toEqual({});
  });

  it("loadConfig reads a valid config.json", async () => {
    writeMockConfigWithProfiles(arcDir, {
      work: { authType: "oauth", tool: "claude" },
    });

    const { loadConfig } = await import("../../src/config.js");
    const config = loadConfig();
    expect(config.version).toBe(1);
    expect(config.activeProfile).toBe("work");
    expect(config.profiles["work"]).toBeDefined();
    expect(config.profiles["work"].authType).toBe("oauth");
  });

  it("saveConfig writes config.json atomically", async () => {
    const { loadConfig, saveConfig } = await import("../../src/config.js");

    // Start with empty config
    const config = loadConfig();
    expect(Object.keys(config.profiles)).toHaveLength(0);

    // Add a profile and save
    const profileDir = path.join(arcDir, "profiles", "test-profile");
    fs.mkdirSync(profileDir, { recursive: true });

    config.profiles["test-profile"] = {
      authType: "api-key",
      tool: "claude",
      configDir: profileDir,
      createdAt: new Date().toISOString(),
    };
    config.activeProfile = "test-profile";
    saveConfig(config);

    // Re-read and verify
    const reloaded = loadConfig();
    expect(reloaded.activeProfile).toBe("test-profile");
    expect(reloaded.profiles["test-profile"]).toBeDefined();
    expect(reloaded.profiles["test-profile"].authType).toBe("api-key");
  });

  it("can create multiple profiles", async () => {
    const { loadConfig, saveConfig } = await import("../../src/config.js");
    const config = loadConfig();

    const profileNames = ["work", "personal", "testing"];
    for (const name of profileNames) {
      const profileDir = path.join(arcDir, "profiles", name);
      fs.mkdirSync(profileDir, { recursive: true });
      config.profiles[name] = {
        authType: "oauth",
        tool: "claude",
        configDir: profileDir,
        createdAt: new Date().toISOString(),
      };
    }
    config.activeProfile = "work";
    saveConfig(config);

    const reloaded = loadConfig();
    expect(Object.keys(reloaded.profiles)).toHaveLength(3);
    expect(reloaded.profiles["work"]).toBeDefined();
    expect(reloaded.profiles["personal"]).toBeDefined();
    expect(reloaded.profiles["testing"]).toBeDefined();
  });

  it("can delete a profile from config", async () => {
    writeMockConfigWithProfiles(arcDir, {
      work: { authType: "oauth" },
      personal: { authType: "api-key" },
    });

    const { loadConfig, saveConfig } = await import("../../src/config.js");
    const config = loadConfig();
    expect(Object.keys(config.profiles)).toHaveLength(2);

    // Delete "personal"
    delete config.profiles["personal"];
    saveConfig(config);

    const reloaded = loadConfig();
    expect(Object.keys(reloaded.profiles)).toHaveLength(1);
    expect(reloaded.profiles["personal"]).toBeUndefined();
    expect(reloaded.profiles["work"]).toBeDefined();
  });

  it("can switch active profile", async () => {
    writeMockConfigWithProfiles(arcDir, {
      work: { authType: "oauth" },
      personal: { authType: "oauth" },
    });

    const { loadConfig, saveConfig } = await import("../../src/config.js");
    const config = loadConfig();
    expect(config.activeProfile).toBe("work");

    config.activeProfile = "personal";
    saveConfig(config);

    const reloaded = loadConfig();
    expect(reloaded.activeProfile).toBe("personal");
  });

  it("validateConfig rejects invalid configs", async () => {
    const { validateConfig } = await import("../../src/config.js");

    expect(validateConfig(null)).toBe(false);
    expect(validateConfig({})).toBe(false);
    expect(validateConfig({ version: 2, activeProfile: "x", profiles: {} })).toBe(false);
    expect(validateConfig({ version: 1, activeProfile: 123, profiles: {} })).toBe(false);
    expect(validateConfig({ version: 1, activeProfile: "x", profiles: "bad" })).toBe(false);
  });

  it("validateConfig accepts valid configs", async () => {
    const { validateConfig } = await import("../../src/config.js");

    expect(
      validateConfig({
        version: 1,
        activeProfile: "default",
        profiles: {},
      })
    ).toBe(true);

    expect(
      validateConfig({
        version: 1,
        activeProfile: "work",
        profiles: {
          work: {
            authType: "oauth",
            configDir: "/tmp/test",
            createdAt: "2025-01-01T00:00:00.000Z",
          },
        },
      })
    ).toBe(true);
  });

  it("profile directories are created on disk", async () => {
    writeMockConfigWithProfiles(arcDir, {
      work: { authType: "oauth" },
    });

    const profileDir = path.join(arcDir, "profiles", "work");
    expect(fs.existsSync(profileDir)).toBe(true);
    expect(fs.statSync(profileDir).isDirectory()).toBe(true);
  });

  it("loadConfig throws on malformed JSON", async () => {
    fs.writeFileSync(path.join(arcDir, "config.json"), "not valid json{{{", "utf-8");

    const { loadConfig } = await import("../../src/config.js");
    expect(() => loadConfig()).toThrow(/malformed JSON/);
  });
});
