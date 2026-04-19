/**
 * End-to-end smoke test for Phases 1–3. Runs against a temp $ARC_DIR so it
 * never touches the user's ~/.arc. Exits 0 on success, non-zero on failure.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startDaemon } from "../src/index.js";
import { ArcClient } from "@axiom-labs/arc-client";

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arc-smoke-"));
  process.env["ARC_DIR"] = tmp;
  const port = 17272 + Math.floor(Math.random() * 1000);
  console.log(`smoke: ARC_DIR=${tmp} port=${port}`);

  const handle = await startDaemon({ port, version: "1.0.0-alpha.0-smoke" });

  const authFile = JSON.parse(fs.readFileSync(path.join(tmp, "auth.json"), "utf8")) as {
    rootToken: string;
  };

  const client = new ArcClient({
    url: `ws://127.0.0.1:${port}`,
    token: authFile.rootToken,
    noReconnect: true,
  });

  try {
    await client.connect();
    console.log("smoke: connected + authed");

    const health = await client.health();
    console.log("smoke: health", JSON.stringify(health));
    if (!health.ok) throw new Error("health not ok");
    if (health.protocol !== 1) throw new Error(`protocol mismatch: ${health.protocol}`);

    const agents = await client.agents.list();
    console.log(`smoke: agents=${agents.agents.length} (expected 0)`);
    if (agents.agents.length !== 0) throw new Error("expected empty agent list");

    const subs: unknown[] = [];
    const unsub = await client.subscribe("daemon", (p) => subs.push(p));
    await unsub();

    console.log("smoke: OK");
  } finally {
    await client.close();
    await handle.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("smoke: FAILED", err);
  process.exit(1);
});
