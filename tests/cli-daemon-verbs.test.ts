import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDaemon, type DaemonHandle } from "@axiom-labs/arc-daemon";
import { handleLs } from "../packages/cli/src/commands/ls.js";
import { handleAttach } from "../packages/cli/src/commands/attach.js";
import { handleSend } from "../packages/cli/src/commands/send.js";
import { handleStopAgent } from "../packages/cli/src/commands/stop-agent.js";

interface TestCtx {
  tmp: string;
  port: number;
  handle: DaemonHandle & { stop: () => Promise<void> };
  prevArcDir: string | undefined;
  prevArcPort: string | undefined;
}

let ctx: TestCtx | null = null;

function captureStdout(): { restore: () => string } {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout.write as unknown) = (chunk: unknown): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : chunk instanceof Buffer ? chunk.toString("utf8") : String(chunk));
    return true;
  };
  return {
    restore: () => {
      process.stdout.write = original;
      return chunks.join("");
    },
  };
}

function captureStderr(): { restore: () => string } {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr.write as unknown) = (chunk: unknown): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : chunk instanceof Buffer ? chunk.toString("utf8") : String(chunk));
    return true;
  };
  return {
    restore: () => {
      process.stderr.write = original;
      return chunks.join("");
    },
  };
}

describe("CLI daemon verbs", () => {
  beforeEach(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arc-cli-verbs-"));
    const port = 17900 + Math.floor(Math.random() * 90);
    const prevArcDir = process.env["ARC_DIR"];
    const prevArcPort = process.env["ARC_PORT"];
    process.env["ARC_DIR"] = tmp;
    process.env["ARC_PORT"] = String(port);
    const handle = await startDaemon({ port, version: "1.0.0-alpha.0-test" });
    ctx = { tmp, port, handle, prevArcDir, prevArcPort };
    // Reset any lingering exit code from a previous test.
    process.exitCode = 0;
  });

  afterEach(async () => {
    if (!ctx) return;
    await ctx.handle.stop();
    // Restore env
    if (ctx.prevArcDir === undefined) delete process.env["ARC_DIR"];
    else process.env["ARC_DIR"] = ctx.prevArcDir;
    if (ctx.prevArcPort === undefined) delete process.env["ARC_PORT"];
    else process.env["ARC_PORT"] = ctx.prevArcPort;
    fs.rmSync(ctx.tmp, { recursive: true, force: true });
    ctx = null;
    process.exitCode = 0;
  });

  it("arc ls prints a header and no rows when no agents exist", async () => {
    const cap = captureStdout();
    await handleLs({});
    const out = cap.restore();
    // With zero agents, should print the friendly "(no agents)" hint.
    expect(out).toMatch(/no agents/i);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("arc ls --json emits an empty array when no agents exist", async () => {
    const cap = captureStdout();
    await handleLs({ json: true });
    const out = cap.restore();
    expect(JSON.parse(out)).toEqual([]);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("arc attach <bogus> prints a friendly error and exits non-zero", async () => {
    const capOut = captureStdout();
    const capErr = captureStderr();
    await handleAttach("does-not-exist-123");
    capOut.restore();
    const err = capErr.restore();
    // Either "not implemented" (agent.attach unimplemented — Unit 2 pending)
    // or "not found" if Unit 2 has landed. Either way we must not crash and
    // must print a helpful message + exit non-zero.
    expect(err.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(1);
  });

  it("arc send <bogus> <text> prints a friendly error and exits non-zero", async () => {
    const capOut = captureStdout();
    const capErr = captureStderr();
    await handleSend("does-not-exist-123", "hello");
    capOut.restore();
    const err = capErr.restore();
    expect(err.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(1);
  });

  it("arc stop <bogus> prints a friendly error and exits non-zero", async () => {
    const capOut = captureStdout();
    const capErr = captureStderr();
    await handleStopAgent("does-not-exist-123");
    capOut.restore();
    const err = capErr.restore();
    expect(err.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(1);
  });
});
