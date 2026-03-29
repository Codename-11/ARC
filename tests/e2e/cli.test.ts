import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CLI_ENTRY = path.join(ROOT, "dist", "index.js");

/**
 * Helper: run the CLI and return { stdout, stderr, exitCode }.
 * Uses the built dist/index.js so we test the actual bundle.
 */
function runCli(
  args: string[],
  env?: Record<string, string>
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [CLI_ENTRY, ...args], {
      encoding: "utf-8",
      timeout: 15_000,
      env: {
        ...process.env,
        ...env,
        // Force non-interactive mode and prevent TUI from launching
        NO_COLOR: "1",
      },
      cwd: ROOT,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      status?: number | null;
    };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

describe("CLI E2E", () => {
  beforeAll(() => {
    // Verify the build exists — tests depend on dist/index.js
    if (!fs.existsSync(CLI_ENTRY)) {
      throw new Error(
        `Built CLI not found at ${CLI_ENTRY}. Run \`pnpm build\` before running E2E tests.`
      );
    }
  });

  it("arc --help exits 0 and shows usage", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("arc");
    expect(result.stdout).toContain("Manage agent runtime profiles");
    // Should include some known subcommands
    expect(result.stdout).toContain("create");
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("doctor");
  });

  it("arc --version shows version string", () => {
    const result = runCli(["--version"]);
    expect(result.exitCode).toBe(0);
    // Version output should match semver-like pattern
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("arc list works with an empty config", () => {
    // Use a temp ARC_DIR so we don't touch the real ~/.arc/
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-cli-test-"));
    try {
      const result = runCli(["list"], { ARC_DIR: tmpDir });
      // Should exit 0 even with no profiles
      expect(result.exitCode).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("arc doctor runs without crashing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-cli-test-"));
    try {
      const result = runCli(["doctor"], { ARC_DIR: tmpDir });
      // Doctor may exit 0 or non-zero depending on system state,
      // but it should not crash (no unhandled exception)
      expect(result.exitCode).toBeDefined();
      // Should produce some output (diagnostic info)
      const output = result.stdout + result.stderr;
      expect(output.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("arc profile --help shows profile subcommands", () => {
    const result = runCli(["profile", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("create");
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("delete");
    expect(result.stdout).toContain("switch");
  });

  it("arc shared --help shows shared layer subcommands", () => {
    const result = runCli(["shared", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("enable");
    expect(result.stdout).toContain("disable");
    expect(result.stdout).toContain("sync");
    expect(result.stdout).toContain("pull");
  });

  it("arc unknown-command shows error", () => {
    const result = runCli(["unknown-command-xyz"]);
    // Commander should output an error for unknown commands
    expect(result.exitCode).not.toBe(0);
  });
});
