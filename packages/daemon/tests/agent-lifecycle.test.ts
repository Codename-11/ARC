import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDaemon, type DaemonHandle } from "../src/index.js";
import { ArcClient } from "@axiom-labs/arc-client";

interface TestCtx {
  tmp: string;
  port: number;
  handle: DaemonHandle & { stop: () => Promise<void> };
  client: ArcClient;
}

describe("agent lifecycle", () => {
  let ctx: TestCtx | null = null;

  beforeEach(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arc-agent-test-"));
    process.env["ARC_DIR"] = tmp;
    const port = 18100 + Math.floor(Math.random() * 800);
    const handle = await startDaemon({ port, version: "1.0.0-alpha.0-test" });
    const authFile = JSON.parse(fs.readFileSync(path.join(tmp, "auth.json"), "utf8")) as {
      rootToken: string;
    };
    const client = new ArcClient({
      url: `ws://127.0.0.1:${port}`,
      token: authFile.rootToken,
      noReconnect: true,
    });
    await client.connect();
    ctx = { tmp, port, handle, client };
  });

  afterEach(async () => {
    if (!ctx) return;
    await ctx.client.close();
    await ctx.handle.stop();
    fs.rmSync(ctx.tmp, { recursive: true, force: true });
    ctx = null;
  });

  it("runs, streams terminal bytes, persists events, and exits cleanly", async () => {
    const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
    let terminalBytes = Buffer.alloc(0);

    const prompt = "hello from agent lifecycle test";
    const { agentId } = await ctx!.client.agents.run({ profile: "_echo", prompt });
    expect(agentId).toMatch(/^[0-9a-f-]{36}$/);

    const attached = await ctx!.client.agents.attach(agentId, {
      onEvent: (e) => events.push({ kind: e.kind, payload: e.payload }),
      onTerminal: (_id, bytes) => {
        terminalBytes = Buffer.concat([terminalBytes, Buffer.from(bytes)]);
      },
    });
    expect(attached.initial.agentId).toBe(agentId);

    // Wait for the child to exit — `_echo` reads stdin, writes it, exits 0.
    await waitFor(() => events.some((e) => e.kind === "exit"), 5000);

    // The list should now have our agent with a terminal status.
    const list = await ctx!.client.agents.list();
    const row = list.agents.find((a) => a.id === agentId);
    expect(row).toBeDefined();
    expect(["completed", "failed"]).toContain(row!.status);

    // Terminal bytes should contain the echoed prompt.
    const terminalText = terminalBytes.toString("utf8");
    expect(terminalText).toContain(prompt);

    // Combine the initial replay with the live events — early spawn may have
    // fired before `attach` returned, so it lands in `initial.events`.
    const allKinds = [...attached.initial.events.map((e) => e.kind), ...events.map((e) => e.kind)];
    expect(allKinds).toContain("spawn");
    expect(allKinds).toContain("exit");

    await attached.dispose();
  });

  it("agent.attach replays persisted events after exit", async () => {
    const { agentId } = await ctx!.client.agents.run({ profile: "_echo", prompt: "replay test" });
    // Wait for exit via polling the list status.
    await waitFor(async () => {
      const list = await ctx!.client.agents.list();
      const row = list.agents.find((a) => a.id === agentId);
      return !!row && (row.status === "completed" || row.status === "failed");
    }, 5000);

    const { initial } = await ctx!.client.agents.attach(agentId);
    expect(initial.agentId).toBe(agentId);
    expect(initial.events.length).toBeGreaterThan(0);
    const exit = initial.events.find((e) => e.kind === "exit");
    expect(exit).toBeDefined();
  });

  it("agent.stop terminates a long-running process", async () => {
    // Spawn a long-lived child via a generic _echo profile that won't self-exit:
    // Use agent.run with a _sleep profile (fallback profile stays alive? no — use _echo but
    // don't send prompt => stdin stays open => process waits for stdin close).
    // Instead we'll run a command via the builtin _echo which waits on stdin; if we don't
    // pass a prompt, the runtime does NOT close stdin, so the child stays alive.
    const { agentId } = await ctx!.client.agents.run({ profile: "_echo" });
    // Give it a moment to move to running.
    await new Promise((r) => setTimeout(r, 150));

    const before = await ctx!.client.agents.list();
    const row = before.agents.find((a) => a.id === agentId);
    expect(row?.status === "running" || row?.status === "starting").toBe(true);

    const stopRes = await ctx!.client.agents.stop({ agentId });
    expect(stopRes.ok).toBe(true);

    await waitFor(async () => {
      const list = await ctx!.client.agents.list();
      const r = list.agents.find((a) => a.id === agentId);
      return !!r && (r.status === "stopped" || r.status === "completed" || r.status === "failed");
    }, 5000);
  });
});

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await predicate();
    if (res) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
