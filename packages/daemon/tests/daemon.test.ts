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
  token: string;
}

// Windows CI can be slow; bump per-test timeouts.
describe("daemon + client end-to-end", () => {
  let ctx: TestCtx | null = null;

  beforeEach(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arc-daemon-test-"));
    process.env["ARC_DIR"] = tmp;
    const port = 17200 + Math.floor(Math.random() * 800);
    const handle = await startDaemon({ port, version: "1.0.0-alpha.0-test" });
    const authFile = JSON.parse(
      fs.readFileSync(path.join(tmp, "auth.json"), "utf8"),
    ) as { rootToken: string };
    const client = new ArcClient({
      url: `ws://127.0.0.1:${port}`,
      token: authFile.rootToken,
      noReconnect: true,
    });
    await client.connect();
    ctx = { tmp, port, handle, client, token: authFile.rootToken };
  });

  afterEach(async () => {
    if (!ctx) return;
    await ctx.client.close();
    await ctx.handle.stop();
    // Windows holds SQLite WAL/SHM + log-stream file handles briefly after close.
    // Retry removal a few times to avoid ENOTEMPTY on CI.
    fs.rmSync(ctx.tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    ctx = null;
  });

  it("exposes a healthy endpoint over RPC", async () => {
    const h = await ctx!.client.health();
    expect(h.ok).toBe(true);
    expect(h.protocol).toBe(1);
    expect(h.port).toBe(ctx!.port);
  });

  it("lists an empty agent set initially", async () => {
    const res = await ctx!.client.agents.list();
    expect(res.agents).toEqual([]);
  });

  it("rejects RPC before auth", async () => {
    const unauthed = new ArcClient({
      url: `ws://127.0.0.1:${ctx!.port}`,
      token: "not-a-real-token-00000000000000000000",
      noReconnect: true,
    });
    await expect(unauthed.connect()).rejects.toThrow();
  });

  it("supports subscribe + unsubscribe round-trip", async () => {
    const received: unknown[] = [];
    const unsub = await ctx!.client.subscribe("daemon", (p) => received.push(p));
    expect(typeof unsub).toBe("function");
    await unsub();
  });
});
