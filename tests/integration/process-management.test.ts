import { describe, expect, it, afterEach } from "vitest";
import {
  spawnManagedProcess,
  isProcessRunning,
  terminateProcess,
  parseJsonlLine,
  waitForProcessExit,
} from "../../packages/core/src/process.js";

// ─── Process management integration tests ────────────────────────────

describe("spawnManagedProcess", () => {
  const spawnedPids: number[] = [];

  afterEach(async () => {
    // Clean up any leftover processes
    for (const pid of spawnedPids) {
      try {
        await terminateProcess(pid);
      } catch {
        // Already dead — fine.
      }
    }
    spawnedPids.length = 0;
  });

  it("spawns a process and returns a handle with a real pid", () => {
    const handle = spawnManagedProcess({
      command: process.platform === "win32" ? "cmd" : "sleep",
      args: process.platform === "win32" ? ["/c", "timeout", "/t", "30", "/nobreak"] : ["30"],
      component: "test",
    });
    spawnedPids.push(handle.pid);

    expect(handle.pid).toBeTypeOf("number");
    expect(handle.pid).toBeGreaterThan(0);
    expect(handle.child).toBeDefined();
    expect(handle.child.pid).toBe(handle.pid);
  });

  it("spawned process has accessible stdout stream", () => {
    const handle = spawnManagedProcess({
      command: process.platform === "win32" ? "cmd" : "sleep",
      args: process.platform === "win32" ? ["/c", "timeout", "/t", "30", "/nobreak"] : ["30"],
      component: "test",
    });
    spawnedPids.push(handle.pid);

    expect(handle.child.stdout).toBeDefined();
    expect(handle.child.stderr).toBeDefined();
    expect(handle.child.stdin).toBeDefined();
  });
});

describe("isProcessRunning", () => {
  it("returns true for a running process", () => {
    const handle = spawnManagedProcess({
      command: process.platform === "win32" ? "cmd" : "sleep",
      args: process.platform === "win32" ? ["/c", "timeout", "/t", "30", "/nobreak"] : ["30"],
      component: "test",
    });

    try {
      expect(isProcessRunning(handle.pid)).toBe(true);
    } finally {
      // Clean up
      terminateProcess(handle.pid).catch(() => {});
    }
  });

  it("returns false after process has exited", async () => {
    // Spawn a process that exits immediately
    const handle = spawnManagedProcess({
      command: process.platform === "win32" ? "cmd" : "true",
      args: process.platform === "win32" ? ["/c", "echo", "done"] : [],
      component: "test",
    });

    // Wait for it to exit
    await new Promise<void>((resolve) => {
      handle.child.once("exit", () => resolve());
    });

    expect(isProcessRunning(handle.pid)).toBe(false);
  });

  it("returns false for a non-existent pid", () => {
    // PID 2147483647 is extremely unlikely to exist
    expect(isProcessRunning(2147483647)).toBe(false);
  });
});

describe("terminateProcess", () => {
  it("kills a running process (verify pid is gone)", async () => {
    const handle = spawnManagedProcess({
      command: process.platform === "win32" ? "cmd" : "sleep",
      args: process.platform === "win32" ? ["/c", "timeout", "/t", "300", "/nobreak"] : ["300"],
      component: "test",
    });

    expect(isProcessRunning(handle.pid)).toBe(true);

    await terminateProcess(handle.pid, "test");

    // Give the OS a moment to reap the process
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(isProcessRunning(handle.pid)).toBe(false);
  });

  it("does not throw for an already-dead process", async () => {
    const handle = spawnManagedProcess({
      command: process.platform === "win32" ? "cmd" : "true",
      args: process.platform === "win32" ? ["/c", "echo", "done"] : [],
      component: "test",
    });

    // Wait for exit
    await new Promise<void>((resolve) => {
      handle.child.once("exit", () => resolve());
    });

    // Should not throw
    await expect(terminateProcess(handle.pid, "test")).resolves.toBeUndefined();
  });
});

// ─── waitForProcessExit ──────────────────────────────────────────────

describe("waitForProcessExit", () => {
  it("resolves when a short-lived process exits", async () => {
    const handle = spawnManagedProcess({
      command: process.platform === "win32" ? "cmd" : "true",
      args: process.platform === "win32" ? ["/c", "echo", "done"] : [],
      component: "test",
    });

    const start = Date.now();
    await waitForProcessExit(handle.pid, 50);
    const elapsed = Date.now() - start;

    // Should resolve quickly (within 2 seconds) for a process that exits immediately
    expect(elapsed).toBeLessThan(2000);
    expect(isProcessRunning(handle.pid)).toBe(false);
  });

  it("resolves after a process is terminated externally", async () => {
    const handle = spawnManagedProcess({
      command: process.platform === "win32" ? "cmd" : "sleep",
      args: process.platform === "win32" ? ["/c", "timeout", "/t", "300", "/nobreak"] : ["300"],
      component: "test",
    });

    expect(isProcessRunning(handle.pid)).toBe(true);

    // Terminate after a short delay
    setTimeout(() => {
      terminateProcess(handle.pid, "test").catch(() => {});
    }, 200);

    await waitForProcessExit(handle.pid, 100);

    expect(isProcessRunning(handle.pid)).toBe(false);
  });

  it("resolves immediately for a non-existent pid", async () => {
    const start = Date.now();
    await waitForProcessExit(2147483647, 50);
    const elapsed = Date.now() - start;

    // Should resolve nearly instantly
    expect(elapsed).toBeLessThan(500);
  });
});

// ─── JSONL parsing ───────────────────────────────────────────────────

describe("parseJsonlLine", () => {
  it("parses valid JSONL with type and content fields", () => {
    const line = '{"type":"message","content":"Hello world"}';
    const result = parseJsonlLine(line);

    expect(result.type).toBe("message");
    expect(result.content).toBe("Hello world");
    expect(result.raw).toBe(line);
  });

  it("parses JSONL with type and message field (falls back to message)", () => {
    const line = '{"type":"error","message":"Something went wrong"}';
    const result = parseJsonlLine(line);

    expect(result.type).toBe("error");
    expect(result.content).toBe("Something went wrong");
  });

  it("returns raw type for valid JSON without type field", () => {
    const line = '{"foo":"bar"}';
    const result = parseJsonlLine(line);

    expect(result.type).toBe("raw");
    expect(result.content).toBe('{"foo":"bar"}');
  });

  it("returns raw type for non-JSON lines", () => {
    const line = "This is just plain text output";
    const result = parseJsonlLine(line);

    expect(result.type).toBe("raw");
    expect(result.content).toBe("This is just plain text output");
    expect(result.raw).toBe(line);
  });

  it("handles empty lines", () => {
    const result = parseJsonlLine("");
    expect(result.type).toBe("raw");
    expect(result.content).toBe("");
  });

  it("handles whitespace-only lines", () => {
    const result = parseJsonlLine("   ");
    expect(result.type).toBe("raw");
    expect(result.content).toBe("");
  });

  it("preserves raw field as the original line", () => {
    const line = '  {"type":"info","content":"trimmed"}  ';
    const result = parseJsonlLine(line);

    expect(result.type).toBe("info");
    expect(result.content).toBe("trimmed");
    expect(result.raw).toBe(line);
  });

  it("handles complex nested JSON objects", () => {
    const line = '{"type":"tool_call","content":"using grep","data":{"tool":"grep","args":["-r","foo"]}}';
    const result = parseJsonlLine(line);

    expect(result.type).toBe("tool_call");
    expect(result.content).toBe("using grep");
  });
});
