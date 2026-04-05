import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RemoteAgentRegistry } from "../../packages/core/src/remote.js";

// Suppress log I/O during tests
vi.mock("../../packages/core/src/logging.js", () => ({
  writeLogEvent: vi.fn(),
}));

// ─── Temp dir setup ─────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-cli-remote-test-"));
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

// ─── Tests ──────────────────────────────────────────────────────────

describe("CLI remote: RemoteAgentRegistry operations", () => {
  let registry: RemoteAgentRegistry;

  beforeEach(() => {
    registry = new RemoteAgentRegistry();
  });

  // ── list ──────────────────────────────────────────────────────

  describe("list()", () => {
    it("returns empty array when registry is empty", () => {
      expect(registry.list()).toEqual([]);
    });

    it("returns agents after registration", () => {
      registry.register({
        name: "worker-1",
        endpoint: "http://localhost:3000",
        transport: "http",
        status: "unknown",
      });
      const agents = registry.list();
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("worker-1");
      expect(agents[0].endpoint).toBe("http://localhost:3000");
      expect(agents[0].transport).toBe("http");
    });

    it("returns multiple agents", () => {
      registry.register({
        name: "worker-1",
        endpoint: "http://host1:3000",
        transport: "http",
        status: "unknown",
      });
      registry.register({
        name: "worker-2",
        endpoint: "http://host2:3000",
        transport: "ssh",
        status: "unknown",
      });
      expect(registry.list()).toHaveLength(2);
    });
  });

  // ── register ─────────────────────────────────────────────────

  describe("register()", () => {
    it("creates an agent with an ID", () => {
      const agent = registry.register({
        name: "my-agent",
        endpoint: "http://localhost:8080",
        transport: "http",
        status: "unknown",
      });
      expect(agent.id).toBeDefined();
      expect(agent.name).toBe("my-agent");
      expect(agent.endpoint).toBe("http://localhost:8080");
    });

    it("defaults transport to the value provided", () => {
      const agent = registry.register({
        name: "default-transport",
        endpoint: "http://example.com",
        transport: "http",
        status: "unknown",
      });
      expect(agent.transport).toBe("http");
    });

    it("stores profile when provided", () => {
      const agent = registry.register({
        name: "profiled",
        endpoint: "http://host.local",
        transport: "http",
        status: "unknown",
        profile: "production",
      });
      expect(agent.profile).toBe("production");
    });

    it("persists agent to disk", () => {
      registry.register({
        name: "persist-test",
        endpoint: "http://persistent.local",
        transport: "http",
        status: "unknown",
      });

      const registry2 = new RemoteAgentRegistry();
      const agents = registry2.list();
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("persist-test");
    });
  });

  // ── unregister ────────────────────────────────────────────────

  describe("unregister()", () => {
    it("removes an existing agent", () => {
      const agent = registry.register({
        name: "to-remove",
        endpoint: "http://remove.local",
        transport: "http",
        status: "unknown",
      });

      registry.unregister(agent.id);
      expect(registry.list()).toHaveLength(0);
    });

    it("throws for non-existent agent ID", () => {
      expect(() => registry.unregister("non-existent-id")).toThrow(/not found/);
    });
  });
});
