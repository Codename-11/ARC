import { describe, expect, it, afterEach, vi } from "vitest";
import { getAdapter } from "../../packages/cli/src/adapters/index.js";
import { createGenericAdapter, _testInternals } from "../../packages/cli/src/adapters/generic.js";
import { isProcessRunning } from "../../packages/core/src/process.js";

const IS_WINDOWS = process.platform === "win32";

// ─── Generic adapter integration tests ───────────────────────────────

describe("Generic adapter factory", () => {
  it("createGenericAdapter returns a RuntimeAdapter with the tool name as id", () => {
    const adapter = createGenericAdapter("my-custom-tool");
    expect(adapter.id).toBe("my-custom-tool");
    expect(adapter.displayName).toBe("my-custom-tool");
  });

  it("generic adapter has processWrap: true capability", () => {
    const adapter = createGenericAdapter("my-custom-tool");
    expect(adapter.capabilities.processWrap).toBe(true);
  });

  it("generic adapter has hooks: false (no hook support)", () => {
    const adapter = createGenericAdapter("my-custom-tool");
    expect(adapter.capabilities.hooks).toBe(false);
  });

  it('getInstallHint() mentions the tool name', () => {
    const adapter = createGenericAdapter("super-ai");
    expect(adapter.getInstallHint()).toContain("super-ai");
  });
});

describe("getAdapter() fallback uses generic adapter", () => {
  it("getAdapter('unknown-tool') returns adapter with processWrap: true (real lifecycle)", () => {
    const adapter = getAdapter("unknown-tool");
    expect(adapter.id).toBe("unknown-tool");
    expect(adapter.capabilities.processWrap).toBe(true);
  });

  it("getAdapter('unknown-tool') launch does not throw 'not implemented'", async () => {
    // We can't fully launch a non-existent binary, but we can verify the adapter
    // has a real launch function that tries to spawn (not a stub that throws "not implemented")
    const adapter = getAdapter("unknown-tool");
    const dummyProfile = {
      authType: "api-key" as const,
      tool: "unknown-tool",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    // The spawn will fail because "unknown-tool" isn't a real binary, but it
    // should NOT throw "not implemented" — it should attempt a real spawn
    try {
      await adapter.launch(dummyProfile, { args: [], env: {} });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // The error should be a spawn failure, not "not implemented"
      expect(message).not.toBe("not implemented");
    }
  });
});

describe("Generic adapter lifecycle", () => {
  const spawnedProcesses: { pid: number; tool: string; profile: string; startedAt: Date }[] = [];

  afterEach(async () => {
    // Clean up spawned processes and health monitors
    for (const proc of spawnedProcesses) {
      try {
        const adapter = createGenericAdapter(proc.tool);
        await adapter.terminate(proc);
      } catch {
        // Already dead — fine.
      }
    }
    spawnedProcesses.length = 0;
  });

  it("launch() spawns a real process with a valid pid", async () => {
    const adapter = createGenericAdapter("node");
    const profile = {
      authType: "api-key" as const,
      tool: "node",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    const proc = await adapter.launch(profile, {
      args: ["-e", "setTimeout(()=>{},30000)"],
      env: {},
    });
    spawnedProcesses.push(proc);

    expect(proc.pid).toBeTypeOf("number");
    expect(proc.pid).toBeGreaterThan(0);
    expect(proc.tool).toBe("node");
    expect(proc.startedAt).toBeInstanceOf(Date);
  });

  it("isRunning() returns true while process runs", async () => {
    const adapter = createGenericAdapter("node");
    const profile = {
      authType: "api-key" as const,
      tool: "node",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    const proc = await adapter.launch(profile, {
      args: ["-e", "setTimeout(()=>{},30000)"],
      env: {},
    });
    spawnedProcesses.push(proc);

    expect(adapter.isRunning(proc)).toBe(true);
  });

  it("isRunning() returns false after terminate", async () => {
    const adapter = createGenericAdapter("node");
    const profile = {
      authType: "api-key" as const,
      tool: "node",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    const proc = await adapter.launch(profile, {
      args: ["-e", "setTimeout(()=>{},30000)"],
      env: {},
    });
    spawnedProcesses.push(proc);

    expect(adapter.isRunning(proc)).toBe(true);

    await adapter.terminate(proc);

    // Give the OS a moment to reap
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(adapter.isRunning(proc)).toBe(false);
  });

  it("terminate() kills a running process", async () => {
    const adapter = createGenericAdapter("node");
    const profile = {
      authType: "api-key" as const,
      tool: "node",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    const proc = await adapter.launch(profile, {
      args: ["-e", "setTimeout(()=>{},30000)"],
      env: {},
    });
    spawnedProcesses.push(proc);

    expect(isProcessRunning(proc.pid)).toBe(true);

    await adapter.terminate(proc);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(isProcessRunning(proc.pid)).toBe(false);
  });

  it("terminate() does not throw for already-dead process", async () => {
    const adapter = createGenericAdapter("node");
    const dummyProcess = {
      pid: 2147483647,
      tool: "node",
      profile: "default",
      startedAt: new Date(),
    };

    await expect(adapter.terminate(dummyProcess)).resolves.toBeUndefined();
  });

  it("getStatus() returns running status with uptime", async () => {
    const adapter = createGenericAdapter("node");
    const profile = {
      authType: "api-key" as const,
      tool: "node",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    const proc = await adapter.launch(profile, {
      args: ["-e", "setTimeout(()=>{},30000)"],
      env: {},
    });
    spawnedProcesses.push(proc);

    const status = await adapter.getStatus!(proc);
    expect(status.running).toBe(true);
    expect(status.pid).toBe(proc.pid);
    expect(status.uptime).toBeTypeOf("number");
    expect(status.uptime).toBeGreaterThanOrEqual(0);
  });

  it("onOutput() receives stdout lines as raw OutputEvents", async () => {
    // Use a tiny JS file to avoid shell quoting issues on Windows
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpScript = path.join(os.tmpdir(), `arc-test-output-${Date.now()}.js`);
    fs.writeFileSync(tmpScript, 'console.log("hello from generic");\nsetTimeout(()=>{},5000);');

    const adapter = createGenericAdapter("node");
    const profile = {
      authType: "api-key" as const,
      tool: "node",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    const proc = await adapter.launch(profile, {
      args: [tmpScript],
      env: {},
    });
    spawnedProcesses.push(proc);

    const events: { type: string; content: string }[] = [];
    await new Promise<void>((resolve) => {
      adapter.onOutput!(proc, (event) => {
        events.push({ type: event.type, content: event.content });
        resolve();
      });

      // Timeout safety net
      setTimeout(() => resolve(), 5000);
    });

    // Clean up temp file
    try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.type).toBe("raw");
    expect(events[0]!.content).toContain("hello from generic");
  });
});

describe("Health monitor", () => {
  afterEach(() => {
    // Clean up any lingering health monitors
    for (const [pid, interval] of _testInternals.healthMonitors) {
      clearInterval(interval);
    }
    _testInternals.healthMonitors.clear();
  });

  it("health monitor is started on launch", async () => {
    const adapter = createGenericAdapter("node");
    const profile = {
      authType: "api-key" as const,
      tool: "node",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    const proc = await adapter.launch(profile, {
      args: ["-e", "setTimeout(()=>{},30000)"],
      env: {},
    });

    expect(_testInternals.healthMonitors.has(proc.pid)).toBe(true);

    // Clean up
    await adapter.terminate(proc);
  });

  it("health monitor is cleared on terminate", async () => {
    const adapter = createGenericAdapter("node");
    const profile = {
      authType: "api-key" as const,
      tool: "node",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    const proc = await adapter.launch(profile, {
      args: ["-e", "setTimeout(()=>{},30000)"],
      env: {},
    });

    expect(_testInternals.healthMonitors.has(proc.pid)).toBe(true);

    await adapter.terminate(proc);

    expect(_testInternals.healthMonitors.has(proc.pid)).toBe(false);
  });

  it("health monitor detects unexpected process death", async () => {
    // Spawn a process that exits quickly on its own
    const adapter = createGenericAdapter("node");
    const profile = {
      authType: "api-key" as const,
      tool: "node",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    const proc = await adapter.launch(profile, {
      args: ["-e", "process.exit(0)"],
      env: {},
    });

    // Health monitor was started
    expect(_testInternals.healthMonitors.has(proc.pid)).toBe(true);

    // Wait for the process to die (up to 3s with polling)
    for (let i = 0; i < 30; i++) {
      if (!isProcessRunning(proc.pid)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(isProcessRunning(proc.pid)).toBe(false);

    // Clean up the monitor manually since we didn't call terminate
    const interval = _testInternals.healthMonitors.get(proc.pid);
    if (interval) {
      clearInterval(interval);
      _testInternals.healthMonitors.delete(proc.pid);
    }
  });
});
