import { describe, expect, it, afterAll } from "vitest";
import { listAdapters, getAdapter } from "../../packages/cli/src/adapters/index.js";
import { isProcessRunning } from "../../packages/core/src/process.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ─── Characterization tests ─────────────────────────────────────────
// These lock down existing adapter behavior as a regression baseline.
// They describe current behavior, not ideal behavior.

describe("Adapter registry", () => {
  it("listAdapters() returns exactly 5 adapters", () => {
    const adapters = listAdapters();
    expect(adapters).toHaveLength(5);
    const ids = adapters.map((a) => a.id);
    expect(ids).toContain("claude");
    expect(ids).toContain("gemini");
    expect(ids).toContain("codex");
    expect(ids).toContain("openclaw");
    expect(ids).toContain("hermes");
  });

  it('getAdapter("claude") returns adapter with id "claude" and displayName "Claude Code"', () => {
    const adapter = getAdapter("claude");
    expect(adapter.id).toBe("claude");
    expect(adapter.displayName).toBe("Claude Code");
  });

  it('getAdapter("gemini") returns adapter with id "gemini" and displayName "Gemini CLI"', () => {
    const adapter = getAdapter("gemini");
    expect(adapter.id).toBe("gemini");
    expect(adapter.displayName).toBe("Gemini CLI");
  });

  it('getAdapter("codex") returns adapter with id "codex" and displayName "Codex CLI"', () => {
    const adapter = getAdapter("codex");
    expect(adapter.id).toBe("codex");
    expect(adapter.displayName).toBe("Codex CLI");
  });

  it("getAdapter() with unknown tool returns a fallback adapter (not undefined/null)", () => {
    const adapter = getAdapter("unknown-tool");
    expect(adapter).toBeDefined();
    expect(adapter).not.toBeNull();
    expect(adapter.id).toBe("unknown-tool");
    expect(adapter.displayName).toBe("unknown-tool");
  });
});

describe("Claude adapter capabilities", () => {
  const adapter = getAdapter("claude");

  it("capabilities.hooks is true", () => {
    expect(adapter.capabilities.hooks).toBe(true);
  });

  it("capabilities.sdkControl is true", () => {
    expect(adapter.capabilities.sdkControl).toBe(true);
  });

  it("capabilities.mcpSupport is true", () => {
    expect(adapter.capabilities.mcpSupport).toBe(true);
  });

  it("capabilities.sandboxing is false", () => {
    expect(adapter.capabilities.sandboxing).toBe(false);
  });

  it('getInstallHint() returns a string containing "claude-code"', () => {
    const hint = adapter.getInstallHint();
    expect(hint).toBeTypeOf("string");
    expect(hint).toContain("claude-code");
  });
});

describe("Gemini adapter capabilities", () => {
  const adapter = getAdapter("gemini");

  it("capabilities.mcpSupport is true", () => {
    expect(adapter.capabilities.mcpSupport).toBe(true);
  });

  it("capabilities.sandboxing is true", () => {
    expect(adapter.capabilities.sandboxing).toBe(true);
  });

  it("capabilities.hooks is false", () => {
    expect(adapter.capabilities.hooks).toBe(false);
  });

  it("capabilities.jsonOutput is true", () => {
    expect(adapter.capabilities.jsonOutput).toBe(true);
  });

  it("getInstallHint() returns a string", () => {
    const hint = adapter.getInstallHint();
    expect(hint).toBeTypeOf("string");
    expect(hint.length).toBeGreaterThan(0);
  });
});

describe("Codex adapter capabilities", () => {
  const adapter = getAdapter("codex");

  it("capabilities.mcpSupport is true", () => {
    expect(adapter.capabilities.mcpSupport).toBe(true);
  });

  it("capabilities.sandboxing is true", () => {
    expect(adapter.capabilities.sandboxing).toBe(true);
  });

  it("capabilities.hooks is false", () => {
    expect(adapter.capabilities.hooks).toBe(false);
  });

  it('getInstallHint() returns a string containing "codex"', () => {
    const hint = adapter.getInstallHint();
    expect(hint).toBeTypeOf("string");
    expect(hint).toContain("codex");
  });
});

describe("Lifecycle stubs (adapters without real lifecycle)", () => {
  // Codex and Gemini now have real lifecycle implementations — only test claude stubs
  const stubAdapterIds = ["claude"] as const;

  for (const id of stubAdapterIds) {
    describe(`${id} adapter`, () => {
      const adapter = getAdapter(id);
      const dummyProfile = {
        authType: "oauth" as const,
        tool: id,
        configDir: "/tmp/fake",
        createdAt: new Date().toISOString(),
      };
      const dummyProcess = {
        pid: 1234,
        tool: id,
        profile: "default",
        startedAt: new Date(),
      };

      it('launch() throws "not implemented"', async () => {
        await expect(
          adapter.launch(dummyProfile, { args: [], env: {} })
        ).rejects.toThrow("not implemented");
      });

      it('terminate() throws "not implemented"', async () => {
        await expect(adapter.terminate(dummyProcess)).rejects.toThrow(
          "not implemented"
        );
      });

      it('isRunning() throws "not implemented"', () => {
        expect(() => adapter.isRunning(dummyProcess)).toThrow(
          "not implemented"
        );
      });
    });
  }
});

describe("Codex adapter real lifecycle", () => {
  const adapter = getAdapter("codex");
  const dummyProcess = {
    pid: 2147483647,
    tool: "codex",
    profile: "default",
    startedAt: new Date(),
  };

  it("isRunning() returns false for a non-existent pid (does not throw)", () => {
    expect(adapter.isRunning(dummyProcess)).toBe(false);
  });

  it("terminate() resolves without throwing for a non-existent pid", async () => {
    await expect(adapter.terminate(dummyProcess)).resolves.toBeUndefined();
  });

  it("launch() spawns a real process (does not throw 'not implemented')", async () => {
    // Use node as the binary since codex may not be installed
    // We test that the adapter's launch path works by confirming it returns an AgentProcess
    // Note: codex adapter hardcodes "codex" as binary, so this will fail to spawn
    // if codex isn't installed. Instead, verify the launch method is a real implementation
    // by checking it doesn't throw "not implemented" — it may throw a spawn error instead.
    const dummyProfile = {
      authType: "api-key" as const,
      tool: "codex" as const,
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    try {
      const proc = await adapter.launch(dummyProfile, { args: ["--help"], env: {} });
      // If codex is installed, it spawned successfully
      expect(proc.pid).toBeTypeOf("number");
      expect(proc.tool).toBe("codex");
      // Clean up
      await adapter.terminate(proc);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // "not implemented" would mean stubs are still in place — that should NOT happen
      expect(msg).not.toBe("not implemented");
      // Any other error (spawn failure, binary not found) is acceptable
    }
  });
});

describe("Gemini adapter real lifecycle", () => {
  const adapter = getAdapter("gemini");
  const dummyProcess = {
    pid: 2147483647,
    tool: "gemini",
    profile: "default",
    startedAt: new Date(),
  };

  it("isRunning() returns false for a non-existent pid (does not throw)", () => {
    expect(adapter.isRunning(dummyProcess)).toBe(false);
  });

  it("terminate() resolves without throwing for a non-existent pid", async () => {
    await expect(adapter.terminate(dummyProcess)).resolves.toBeUndefined();
  });

  it("launch() spawns a real process (does not throw 'not implemented')", async () => {
    const dummyProfile = {
      authType: "api-key" as const,
      tool: "gemini" as const,
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    try {
      const proc = await adapter.launch(dummyProfile, { args: ["--help"], env: {} });
      // If gemini is installed, it spawned successfully
      expect(proc.pid).toBeTypeOf("number");
      expect(proc.tool).toBe("gemini");
      // Clean up
      await adapter.terminate(proc);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // "not implemented" would mean stubs are still in place — that should NOT happen
      expect(msg).not.toBe("not implemented");
      // Any other error (spawn failure, binary not found) is acceptable
    }
  });
});

describe("Generic adapter real lifecycle (via getAdapter)", () => {
  const pidsToClean: number[] = [];

  afterAll(async () => {
    // Clean up any spawned processes
    const { terminateProcess } = await import("../../packages/core/src/process.js");
    for (const pid of pidsToClean) {
      try { await terminateProcess(pid, "test-cleanup"); } catch { /* already dead */ }
    }
  });

  it("getAdapter('unknown-tool') returns an adapter with real launch (not stubbed)", async () => {
    const adapter = getAdapter("unknown-tool");
    const dummyProfile = {
      authType: "api-key" as const,
      tool: "unknown-tool",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    // The generic adapter's launch will try to spawn "unknown-tool" binary,
    // which doesn't exist. Verify it doesn't throw "not implemented".
    try {
      const proc = await adapter.launch(dummyProfile, { args: [], env: {} });
      // Shouldn't get here since "unknown-tool" doesn't exist as a binary
      pidsToClean.push(proc.pid);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toBe("not implemented");
      // Expected: spawn error because "unknown-tool" binary doesn't exist
    }
  });

  it("generic adapter launches a real process with node", async () => {
    // Create a temp script that prints and exits
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-test-"));
    const scriptPath = path.join(tmpDir, "test-script.js");
    fs.writeFileSync(scriptPath, 'console.log("hello from generic"); process.exit(0);');

    const adapter = getAdapter("node");
    const dummyProfile = {
      authType: "api-key" as const,
      tool: "node",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    const proc = await adapter.launch(dummyProfile, {
      args: [scriptPath],
      env: {},
    });

    expect(proc.pid).toBeTypeOf("number");
    expect(proc.pid).toBeGreaterThan(0);
    expect(proc.tool).toBe("node");
    pidsToClean.push(proc.pid);

    // Wait for the short script to exit (up to 3s with polling)
    for (let i = 0; i < 30; i++) {
      if (!isProcessRunning(proc.pid)) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Process should have exited
    expect(isProcessRunning(proc.pid)).toBe(false);

    // Clean up temp files
    fs.unlinkSync(scriptPath);
    fs.rmdirSync(tmpDir);
  });

  it("generic adapter's onOutput captures stdout lines", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-test-"));
    const scriptPath = path.join(tmpDir, "output-script.js");
    fs.writeFileSync(scriptPath, [
      'console.log("line-one");',
      'console.log("line-two");',
      'setTimeout(() => process.exit(0), 200);',
    ].join("\n"));

    const adapter = getAdapter("node");
    const dummyProfile = {
      authType: "api-key" as const,
      tool: "node",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    const proc = await adapter.launch(dummyProfile, {
      args: [scriptPath],
      env: {},
    });
    pidsToClean.push(proc.pid);

    const captured: string[] = [];
    adapter.onOutput!(proc, (event) => {
      captured.push(event.content);
    });

    // Wait for script to run and output to be captured
    await new Promise((r) => setTimeout(r, 1000));

    expect(captured).toContain("line-one");
    expect(captured).toContain("line-two");

    // Clean up
    try { await adapter.terminate(proc); } catch { /* already exited */ }
    fs.unlinkSync(scriptPath);
    fs.rmdirSync(tmpDir);
  });

  it("generic adapter terminate() kills a running process", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-test-"));
    const scriptPath = path.join(tmpDir, "long-script.js");
    fs.writeFileSync(scriptPath, 'setInterval(() => {}, 1000);'); // runs forever

    const adapter = getAdapter("node");
    const dummyProfile = {
      authType: "api-key" as const,
      tool: "node",
      configDir: "/tmp/fake",
      createdAt: new Date().toISOString(),
    };

    const proc = await adapter.launch(dummyProfile, {
      args: [scriptPath],
      env: {},
    });
    pidsToClean.push(proc.pid);

    // Verify it's running
    expect(isProcessRunning(proc.pid)).toBe(true);

    // Terminate it
    await adapter.terminate(proc);

    // Wait for process to exit (up to 3s with polling)
    for (let i = 0; i < 30; i++) {
      if (!isProcessRunning(proc.pid)) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Verify it's dead
    expect(isProcessRunning(proc.pid)).toBe(false);

    // Clean up
    fs.unlinkSync(scriptPath);
    fs.rmdirSync(tmpDir);
  });
});
