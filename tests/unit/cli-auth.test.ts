import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig, saveConfig } from "../../packages/core/src/config.js";
import type { ArcConfig } from "../../packages/core/src/types.js";

// Suppress log I/O during tests
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

// ─── Temp dir setup ─────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-cli-auth-test-"));
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

// ─── Helper: write a valid ARC config with profiles ─────────────────

function writeConfig(profiles: Record<string, any>, activeProfile = "default") {
  const config: ArcConfig = {
    version: 1,
    activeProfile,
    profiles,
  };
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "config.json"),
    JSON.stringify(config, null, 2),
  );
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("CLI auth: config and profile operations", () => {
  // ── loadConfig ────────────────────────────────────────────────

  describe("loadConfig()", () => {
    it("returns default config when no config.json exists", () => {
      const config = loadConfig();
      expect(config.version).toBe(1);
      expect(config.activeProfile).toBe("default");
      expect(Object.keys(config.profiles)).toHaveLength(0);
    });

    it("loads config with profiles", () => {
      writeConfig({
        default: {
          authType: "oauth",
          configDir: path.join(tmpDir, "profiles", "default"),
          createdAt: new Date().toISOString(),
          tool: "claude",
        },
      });
      const config = loadConfig();
      expect(Object.keys(config.profiles)).toHaveLength(1);
      expect(config.profiles["default"]).toBeDefined();
      expect(config.profiles["default"].authType).toBe("oauth");
    });

    it("loads multiple profiles", () => {
      writeConfig({
        alpha: {
          authType: "api-key",
          configDir: path.join(tmpDir, "profiles", "alpha"),
          createdAt: new Date().toISOString(),
          tool: "codex",
        },
        beta: {
          authType: "oauth",
          configDir: path.join(tmpDir, "profiles", "beta"),
          createdAt: new Date().toISOString(),
          tool: "claude",
        },
      });
      const config = loadConfig();
      expect(Object.keys(config.profiles)).toHaveLength(2);
      expect(config.profiles["alpha"]).toBeDefined();
      expect(config.profiles["beta"]).toBeDefined();
    });
  });

  // ── profile lookup ────────────────────────────────────────────

  describe("profile lookup", () => {
    it("finds a profile by name", () => {
      writeConfig({
        myprofile: {
          authType: "oauth",
          configDir: path.join(tmpDir, "profiles", "myprofile"),
          createdAt: new Date().toISOString(),
          tool: "claude",
        },
      });
      const config = loadConfig();
      const profile = config.profiles["myprofile"];
      expect(profile).toBeDefined();
      expect(profile.authType).toBe("oauth");
    });

    it("returns undefined for non-existent profile", () => {
      writeConfig({});
      const config = loadConfig();
      expect(config.profiles["ghost-profile"]).toBeUndefined();
    });
  });

  // ── saveConfig ────────────────────────────────────────────────

  describe("saveConfig()", () => {
    it("persists config to disk", () => {
      const config: ArcConfig = {
        version: 1,
        activeProfile: "dev",
        profiles: {
          dev: {
            authType: "oauth",
            configDir: path.join(tmpDir, "profiles", "dev"),
            createdAt: new Date().toISOString(),
            tool: "gemini",
          },
        },
      };
      saveConfig(config);

      const loaded = loadConfig();
      expect(loaded.activeProfile).toBe("dev");
      expect(loaded.profiles["dev"]).toBeDefined();
      expect(loaded.profiles["dev"].tool).toBe("gemini");
    });
  });

  // ── active profile ────────────────────────────────────────────

  describe("active profile", () => {
    it("activeProfile points to correct profile", () => {
      writeConfig(
        {
          main: {
            authType: "oauth",
            configDir: path.join(tmpDir, "profiles", "main"),
            createdAt: new Date().toISOString(),
            tool: "claude",
          },
        },
        "main",
      );
      const config = loadConfig();
      expect(config.activeProfile).toBe("main");
      expect(config.profiles[config.activeProfile]).toBeDefined();
      expect(config.profiles[config.activeProfile].tool).toBe("claude");
    });

    it("active profile may not exist in profiles map", () => {
      // Default config has activeProfile "default" but no profile entry
      const config = loadConfig();
      expect(config.activeProfile).toBe("default");
      expect(config.profiles[config.activeProfile]).toBeUndefined();
    });
  });

  // ── whoami equivalent (active profile details) ────────────────

  describe("whoami equivalent", () => {
    it("resolves active profile details", () => {
      writeConfig(
        {
          dev: {
            authType: "oauth",
            configDir: path.join(tmpDir, "profiles", "dev"),
            createdAt: new Date().toISOString(),
            tool: "gemini",
          },
        },
        "dev",
      );
      const config = loadConfig();
      const activeProfile = config.profiles[config.activeProfile];
      expect(activeProfile).toBeDefined();
      expect(activeProfile.tool).toBe("gemini");
    });

    it("specific profile lookup by name", () => {
      writeConfig({
        alpha: {
          authType: "api-key",
          configDir: path.join(tmpDir, "profiles", "alpha"),
          createdAt: new Date().toISOString(),
          tool: "codex",
        },
        beta: {
          authType: "oauth",
          configDir: path.join(tmpDir, "profiles", "beta"),
          createdAt: new Date().toISOString(),
          tool: "claude",
        },
      });
      const config = loadConfig();
      const beta = config.profiles["beta"];
      expect(beta).toBeDefined();
      expect(beta.tool).toBe("claude");
    });
  });
});
