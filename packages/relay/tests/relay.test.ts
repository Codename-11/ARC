import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startRelay, type RelayHandle } from "@axiom-labs/arc-relay";

let relay: RelayHandle;

beforeEach(async () => {
  // port: 0 → OS picks a free port. Test talks to the bound port via `relay.port`.
  relay = await startRelay({ port: 0, host: "127.0.0.1" });
});

afterEach(async () => {
  await relay.stop();
});

function wsUrl(pair: string): string {
  return `ws://127.0.0.1:${relay.port}/?pair=${encodeURIComponent(pair)}`;
}

function open(pair: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(pair));
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextBinary(ws: WebSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      ws.off("error", onError);
      // `ws` delivers Buffer by default for binary frames.
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
      if (!isBinary) {
        reject(new Error("expected binary frame"));
        return;
      }
      resolve(buf);
    };
    const onError = (err: Error): void => {
      ws.off("message", onMessage);
      reject(err);
    };
    ws.once("message", onMessage);
    ws.once("error", onError);
  });
}

function nextClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once("close", (code) => resolve(code));
  });
}

describe("relay", () => {
  it("routes binary bytes A → B and B → A", async () => {
    const a = await open("round-trip");
    const b = await open("round-trip");

    const bGot = nextBinary(b);
    a.send(Buffer.from("hello from a"), { binary: true });
    expect((await bGot).toString("utf8")).toBe("hello from a");

    const aGot = nextBinary(a);
    b.send(Buffer.from("hi back from b"), { binary: true });
    expect((await aGot).toString("utf8")).toBe("hi back from b");

    a.close();
    b.close();
  });

  it("closes B when A disconnects", async () => {
    const a = await open("teardown");
    const b = await open("teardown");

    const bClosed = nextClose(b);
    a.close();
    const code = await bClosed;
    // We sent `close(1000, ...)`. ws may expose that as 1000 or 1005 (no code)
    // depending on how the other side terminated; accept either.
    expect([1000, 1005, 1006]).toContain(code);
  });

  it("rejects a third connection to the same pair", async () => {
    const a = await open("full");
    const b = await open("full");

    await expect(open("full")).rejects.toThrow();

    a.close();
    b.close();
  });

  it("rejects connections without a pair code", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/`);
    const err = await new Promise<Error>((resolve) => {
      ws.once("error", resolve);
      ws.once("open", () => resolve(new Error("unexpected open")));
    });
    expect(err.message).toMatch(/400|Unexpected/);
  });

  it("keeps pairs independent", async () => {
    const a1 = await open("room-1");
    const b1 = await open("room-1");
    const a2 = await open("room-2");
    const b2 = await open("room-2");

    const b1Got = nextBinary(b1);
    const b2Got = nextBinary(b2);
    a1.send(Buffer.from("one"), { binary: true });
    a2.send(Buffer.from("two"), { binary: true });

    expect((await b1Got).toString("utf8")).toBe("one");
    expect((await b2Got).toString("utf8")).toBe("two");

    a1.close();
    b1.close();
    a2.close();
    b2.close();
  });
});
