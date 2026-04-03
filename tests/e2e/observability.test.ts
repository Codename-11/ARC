import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CLI_ENTRY = path.join(ROOT, "dist", "index.js");

function runCli(args: string[], env?: Record<string, string>) {
  try {
    const stdout = execFileSync("node", [CLI_ENTRY, ...args], {
      encoding: "utf-8",
      timeout: 15_000,
      env: {
        ...process.env,
        ...env,
        NO_COLOR: "1",
      },
      cwd: ROOT,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number | null };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

describe("Logs and health E2E", () => {
  beforeAll(() => {
    if (!fs.existsSync(CLI_ENTRY)) {
      throw new Error(`Built CLI not found at ${CLI_ENTRY}. Run pnpm build before running E2E tests.`);
    }
  });

  it("emits structured events that can be queried with arc logs --json", () => {
    const arcDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-observe-"));
    try {
      const create = runCli(["create", "work", "--tool", "claude", "--auth-type", "oauth"], { ARC_DIR: arcDir });
      expect(create.exitCode).toBe(0);

      const health = runCli(["health", "--json"], { ARC_DIR: arcDir });
      expect(health.stdout.trim().startsWith("{")).toBe(true);
      const healthPayload = JSON.parse(health.stdout);
      expect(healthPayload.summary).toBeDefined();
      expect(Array.isArray(healthPayload.systemChecks)).toBe(true);

      const logs = runCli(["logs", "--limit", "20", "--json"], { ARC_DIR: arcDir });
      expect(logs.exitCode).toBe(0);
      const entries = JSON.parse(logs.stdout);
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.some((entry: { action?: string }) => entry.action === "profile.create")).toBe(true);
      expect(entries.some((entry: { action?: string }) => entry.action === "health.completed")).toBe(true);
    } finally {
      fs.rmSync(arcDir, { recursive: true, force: true });
    }
  });
});
