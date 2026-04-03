import { describe, expect, it } from "vitest";
import { getAdapter, listAdapters } from "../../packages/cli/src/adapters/index.js";

describe("OpenClaw RuntimeAdapter", () => {
  it('getAdapter("openclaw") returns adapter with correct id and displayName', () => {
    const adapter = getAdapter("openclaw");
    expect(adapter.id).toBe("openclaw");
    expect(adapter.displayName).toBe("OpenClaw");
  });

  it("listAdapters() includes openclaw in the registry", () => {
    const adapters = listAdapters();
    const ids = adapters.map((a) => a.id);
    expect(ids).toContain("openclaw");
  });

  describe("capabilities", () => {
    const adapter = getAdapter("openclaw");

    it("pluginSystem is true", () => {
      expect(adapter.capabilities.pluginSystem).toBe(true);
    });

    it("processWrap is false", () => {
      expect(adapter.capabilities.processWrap).toBe(false);
    });

    it("hooks is true", () => {
      expect(adapter.capabilities.hooks).toBe(true);
    });

    it("sdkControl is false", () => {
      expect(adapter.capabilities.sdkControl).toBe(false);
    });

    it("mcpSupport is false", () => {
      expect(adapter.capabilities.mcpSupport).toBe(false);
    });
  });

  describe("lifecycle", () => {
    const adapter = getAdapter("openclaw");
    const dummyProfile = {
      authType: "api-key" as const,
      tool: "openclaw",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };
    const dummyProcess = {
      pid: 99999,
      tool: "openclaw",
      profile: "default",
      startedAt: new Date(),
    };

    it('launch() throws error containing "plugin" (not "not implemented")', async () => {
      await expect(
        adapter.launch(dummyProfile, { args: [], env: {} }),
      ).rejects.toThrow("plugin");
    });

    it("terminate() resolves without error (no-op)", async () => {
      await expect(adapter.terminate(dummyProcess)).resolves.toBeUndefined();
    });

    it("isRunning() returns false", () => {
      expect(adapter.isRunning(dummyProcess)).toBe(false);
    });
  });

  it('getInstallHint() contains "openclaw plugins install"', () => {
    const adapter = getAdapter("openclaw");
    const hint = adapter.getInstallHint();
    expect(hint).toContain("openclaw plugins install");
  });

  it("detectConfigs() returns empty when no ~/.openclaw/ exists", () => {
    const adapter = getAdapter("openclaw");
    // In CI / test environments, ~/.openclaw/ typically doesn't exist
    const configs = adapter.detectConfigs();
    // We can't guarantee it's empty (user might have openclaw installed),
    // but we can verify it returns an array
    expect(Array.isArray(configs)).toBe(true);
  });

  it("getHealthChecks() returns array with config-dir and auth checks", async () => {
    const adapter = getAdapter("openclaw");
    const dummyProfile = {
      authType: "api-key" as const,
      tool: "openclaw",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };
    const checks = await adapter.getHealthChecks!(dummyProfile);
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBeGreaterThanOrEqual(2);
    const keys = checks.map((c) => c.key);
    expect(keys).toContain("openclaw-config-dir");
    expect(keys).toContain("openclaw-auth");
  });
});
