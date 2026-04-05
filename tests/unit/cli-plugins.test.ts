import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PluginRegistry } from "../../packages/core/src/plugins/registry.js";

// Suppress log I/O during tests
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

// ─── Temp dir setup ─────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-cli-plugins-test-"));
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

// ─── Helper: create a valid plugin directory with manifest ──────────

function createPluginSource(name: string, opts?: Partial<{
  version: string;
  description: string;
  capabilities: string[];
  arc: string;
}>): string {
  const pluginDir = path.join(tmpDir, "plugin-sources", name);
  fs.mkdirSync(pluginDir, { recursive: true });

  const manifest = {
    name,
    version: opts?.version ?? "1.0.0",
    description: opts?.description ?? `Test plugin ${name}`,
    capabilities: opts?.capabilities ?? ["hook"],
    compatibility: { arc: opts?.arc ?? "^1.0.0" },
  };

  fs.writeFileSync(
    path.join(pluginDir, "plugin.json"),
    JSON.stringify(manifest, null, 2),
  );
  // Write a dummy entry point
  fs.writeFileSync(
    path.join(pluginDir, "index.js"),
    'module.exports = {};\n',
  );

  return pluginDir;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("CLI plugins: PluginRegistry operations", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  // ── list ──────────────────────────────────────────────────────

  describe("list()", () => {
    it("returns empty array when no plugins installed", () => {
      expect(registry.list()).toEqual([]);
    });

    it("returns installed plugins", () => {
      const pluginDir = createPluginSource("test-hook");
      registry.install(pluginDir);
      const plugins = registry.list();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].manifest.name).toBe("test-hook");
    });

    it("returns multiple plugins", () => {
      const dir1 = createPluginSource("plugin-alpha");
      const dir2 = createPluginSource("plugin-beta");
      registry.install(dir1);
      registry.install(dir2);

      const plugins = registry.list();
      expect(plugins).toHaveLength(2);
      const names = plugins.map((p) => p.manifest.name);
      expect(names).toContain("plugin-alpha");
      expect(names).toContain("plugin-beta");
    });
  });

  // ── install ───────────────────────────────────────────────────

  describe("install()", () => {
    it("installs a plugin and returns the entry", () => {
      const pluginDir = createPluginSource("fresh-plugin", {
        description: "A fresh new plugin",
        capabilities: ["skill"],
      });
      const installed = registry.install(pluginDir);
      expect(installed.manifest.name).toBe("fresh-plugin");
      expect(installed.manifest.description).toBe("A fresh new plugin");
      expect(installed.manifest.capabilities).toContain("skill");
      expect(installed.enabled).toBe(true);
      expect(installed.installedAt).toBeDefined();
    });

    it("throws when plugin.json is missing", () => {
      const emptyDir = path.join(tmpDir, "empty-plugin");
      fs.mkdirSync(emptyDir, { recursive: true });
      expect(() => registry.install(emptyDir)).toThrow(/No plugin\.json/);
    });

    it("throws for duplicate plugin install", () => {
      const pluginDir = createPluginSource("dupe-plugin");
      registry.install(pluginDir);
      expect(() => registry.install(pluginDir)).toThrow(/already installed/);
    });
  });

  // ── uninstall ─────────────────────────────────────────────────

  describe("uninstall()", () => {
    it("removes an installed plugin", () => {
      const pluginDir = createPluginSource("removable");
      registry.install(pluginDir);

      registry.uninstall("removable");
      expect(registry.list()).toHaveLength(0);
    });

    it("throws for non-installed plugin", () => {
      expect(() => registry.uninstall("ghost-plugin")).toThrow(/not installed/);
    });
  });

  // ── enable / disable ──────────────────────────────────────────

  describe("enable() / disable()", () => {
    it("disables and re-enables a plugin", () => {
      const pluginDir = createPluginSource("toggle-plugin");
      registry.install(pluginDir);

      registry.disable("toggle-plugin");
      let plugins = registry.list();
      expect(plugins[0].enabled).toBe(false);

      registry.enable("toggle-plugin");
      plugins = registry.list();
      expect(plugins[0].enabled).toBe(true);
    });
  });
});
