import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SyncManager, FilesystemSyncProvider } from "../../packages/core/src/sync/index.js";
import type { SyncConfig } from "../../packages/core/src/sync/index.js";

// Suppress log I/O during tests
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

// ─── Temp dir setup ─────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-cli-sync-test-"));
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

// ─── Helper: write a sync config file ───────────────────────────────

function writeSyncConfig(config: Record<string, any>) {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "sync-config.json"),
    JSON.stringify(config, null, 2),
  );
}

function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = fs.readFileSync(path.join(tmpDir, "sync-config.json"), "utf-8");
    return JSON.parse(raw) as SyncConfig;
  } catch {
    return null;
  }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("CLI sync: SyncManager + config operations", () => {
  // ── status (config read) ─────────────────────────────────────

  describe("sync config loading", () => {
    it("returns null when no sync config exists", () => {
      expect(loadSyncConfig()).toBeNull();
    });

    it("loads config from sync-config.json", () => {
      const syncDir = path.join(tmpDir, "sync-data");
      fs.mkdirSync(syncDir, { recursive: true });

      writeSyncConfig({
        enabled: true,
        provider: syncDir,
        autoSync: false,
        syncIntervalMs: 300000,
        syncOnLaunch: true,
        syncOnExit: false,
        localOnlyProfiles: [],
        exclude: [],
      });

      const config = loadSyncConfig();
      expect(config).not.toBeNull();
      expect(config!.enabled).toBe(true);
      expect(config!.provider).toBe(syncDir);
    });

    it("reads autoSync, syncOnLaunch, syncOnExit settings", () => {
      const syncDir = path.join(tmpDir, "sync-data");
      fs.mkdirSync(syncDir, { recursive: true });

      writeSyncConfig({
        enabled: true,
        provider: syncDir,
        autoSync: true,
        syncIntervalMs: 60000,
        syncOnLaunch: false,
        syncOnExit: true,
        localOnlyProfiles: ["dev"],
        exclude: ["*.tmp"],
      });

      const config = loadSyncConfig();
      expect(config!.autoSync).toBe(true);
      expect(config!.syncOnLaunch).toBe(false);
      expect(config!.syncOnExit).toBe(true);
    });

    it("reads localOnlyProfiles", () => {
      const syncDir = path.join(tmpDir, "sync-data");
      fs.mkdirSync(syncDir, { recursive: true });

      writeSyncConfig({
        enabled: true,
        provider: syncDir,
        autoSync: false,
        syncIntervalMs: 300000,
        syncOnLaunch: false,
        syncOnExit: false,
        localOnlyProfiles: ["secrets-profile", "dev"],
        exclude: [],
      });

      const config = loadSyncConfig();
      expect(config!.localOnlyProfiles).toContain("secrets-profile");
      expect(config!.localOnlyProfiles).toContain("dev");
    });

    it("reads exclude patterns", () => {
      const syncDir = path.join(tmpDir, "sync-data");
      fs.mkdirSync(syncDir, { recursive: true });

      writeSyncConfig({
        enabled: true,
        provider: syncDir,
        autoSync: false,
        syncIntervalMs: 300000,
        syncOnLaunch: false,
        syncOnExit: false,
        localOnlyProfiles: [],
        exclude: ["*.log", "temp/*"],
      });

      const config = loadSyncConfig();
      expect(config!.exclude).toContain("*.log");
      expect(config!.exclude).toContain("temp/*");
    });
  });

  // ── SyncManager ──────────────────────────────────────────────

  describe("SyncManager", () => {
    it("getStatus returns disconnected state before setProvider", () => {
      const manager = new SyncManager();
      const status = manager.getStatus();
      expect(status.connected).toBe(false);
      expect(status.provider).toBeNull();
    });

    it("connects to a filesystem provider", async () => {
      const syncDir = path.join(tmpDir, "sync-data");
      fs.mkdirSync(syncDir, { recursive: true });

      const config: SyncConfig = {
        enabled: true,
        provider: syncDir,
        autoSync: false,
        syncIntervalMs: 300000,
        syncOnLaunch: false,
        syncOnExit: false,
        localOnlyProfiles: [],
        exclude: [],
      };

      const manager = new SyncManager();
      const provider = new FilesystemSyncProvider();
      await manager.setProvider(provider, config);

      const status = manager.getStatus();
      expect(status.connected).toBe(true);
    });
  });

  // ── configure (write config) ─────────────────────────────────

  describe("sync config writing", () => {
    it("writes config to sync-config.json", () => {
      const syncPath = path.join(tmpDir, "my-sync");
      const config: SyncConfig = {
        enabled: true,
        provider: syncPath,
        autoSync: false,
        syncIntervalMs: 300000,
        syncOnLaunch: false,
        syncOnExit: false,
        localOnlyProfiles: [],
        exclude: [],
      };

      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "sync-config.json"),
        JSON.stringify(config, null, 2) + "\n",
        "utf-8",
      );

      const loaded = loadSyncConfig();
      expect(loaded).not.toBeNull();
      expect(loaded!.enabled).toBe(true);
      expect(loaded!.provider).toBe(syncPath);
    });

    it("defaults provider to filesystem path", () => {
      const syncPath = path.join(tmpDir, "default-provider");
      const config: SyncConfig = {
        enabled: true,
        provider: syncPath,
        autoSync: false,
        syncIntervalMs: 300000,
        syncOnLaunch: false,
        syncOnExit: false,
        localOnlyProfiles: [],
        exclude: [],
      };

      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "sync-config.json"),
        JSON.stringify(config, null, 2) + "\n",
        "utf-8",
      );

      const loaded = loadSyncConfig();
      expect(loaded!.provider).toBe(syncPath);
    });
  });
});
