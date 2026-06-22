// Tests for the dashboard's daemon bridge.
//
// We can't import the browser-side `arc-client-bridge.js` directly under
// Node because it expects `window.WebSocket`. What we CAN verify is that
// its wire format matches the canonical client codec — because that's the
// whole point of the shim. Read the shim source and exercise its exported
// codec functions under a minimal shim for DOM globals.
//
// Also sanity-checks the dashboard helpers that expose the daemon token
// over HTTP (`readDaemonRootToken`, `isLocalRequest`).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

import { encodeFrame, decodeFrame, encodeControl, Channel } from "@axiom-labs/arc-client";
import { isLocalRequest, readDaemonRootToken } from "../src/api.js";

// ---------------------------------------------------------------------------
// The bridge is a browser module. Strip the `export` keywords + require
// `ArcClient` instance under a Node sandbox that provides a global
// `WebSocket` stub. This proves the codec round-trips identically with the
// authoritative Zod-validated client codec.
// ---------------------------------------------------------------------------

const bridgePath = fileURLToPath(
  new URL("../public/components/arc-client-bridge.js", import.meta.url),
);

async function loadBridgeExports(): Promise<{
  encodeFrame: (channel: number, flags: number, payload: Uint8Array) => Uint8Array;
  decodeFrame: (buf: Uint8Array) => { channel: number; flags: number; payload: Uint8Array };
  encodeControl: (obj: unknown) => Uint8Array;
  decodeControlPayload: (payload: Uint8Array) => unknown;
  Channel: Record<string, number>;
  PROTOCOL_VERSION: number;
}> {
  // Provide a no-op WebSocket global so the module loads without errors.
  type WsStubCtor = new (url: string, protocols?: string | string[]) => unknown;
  const stub: WsStubCtor = class {
    constructor(_url: string, _protocols?: string | string[]) {
      /* unused */
    }
  };
  (globalThis as { WebSocket?: WsStubCtor }).WebSocket = stub;
  const mod = (await import(
    /* @vite-ignore */ `file://${bridgePath.replace(/\\/g, "/")}`
  )) as {
    encodeFrame: (channel: number, flags: number, payload: Uint8Array) => Uint8Array;
    decodeFrame: (buf: Uint8Array) => { channel: number; flags: number; payload: Uint8Array };
    encodeControl: (obj: unknown) => Uint8Array;
    decodeControlPayload: (payload: Uint8Array) => unknown;
    Channel: Record<string, number>;
    PROTOCOL_VERSION: number;
  };
  return mod;
}

describe("arc-client-bridge frame codec", () => {
  it("round-trips arbitrary payloads identically to @axiom-labs/arc-client", async () => {
    const bridge = await loadBridgeExports();
    const payloads = [
      new Uint8Array(0),
      new Uint8Array([1, 2, 3]),
      new TextEncoder().encode('{"v":1,"id":"abc","type":"request","method":"health.get"}'),
      new Uint8Array(1024).fill(0x7f),
    ];
    for (const p of payloads) {
      const bridgeEncoded = bridge.encodeFrame(bridge.Channel.Control, 0, p);
      const clientEncoded = encodeFrame({ channel: 0, flags: 0, payload: p });
      expect(Array.from(bridgeEncoded)).toEqual(Array.from(clientEncoded));

      const bridgeDecoded = bridge.decodeFrame(bridgeEncoded);
      const clientDecoded = decodeFrame(clientEncoded);
      expect(bridgeDecoded.channel).toBe(clientDecoded.channel);
      expect(bridgeDecoded.flags).toBe(clientDecoded.flags);
      expect(Array.from(bridgeDecoded.payload)).toEqual(Array.from(clientDecoded.payload));
    }
  });

  it("encodes control envelopes byte-for-byte matching the canonical codec", async () => {
    const bridge = await loadBridgeExports();
    const envelope = { v: 1, id: "42", type: "request", method: "health.get" };
    const fromBridge = bridge.encodeControl(envelope);
    const fromClient = encodeControl(envelope);
    expect(Array.from(fromBridge)).toEqual(Array.from(fromClient));
  });

  it("uses channel 0 for control and respects the 6-byte header", async () => {
    const bridge = await loadBridgeExports();
    expect(bridge.Channel.Control).toBe(Channel.Control);
    expect(bridge.PROTOCOL_VERSION).toBe(1);
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const encoded = bridge.encodeFrame(bridge.Channel.Control, 0, payload);
    expect(encoded[0]).toBe(0); // channel
    expect(encoded[1]).toBe(0); // flags
    expect(encoded[2]).toBe(0);
    expect(encoded[3]).toBe(0);
    expect(encoded[4]).toBe(0);
    expect(encoded[5]).toBe(4); // length
    expect(Array.from(encoded.subarray(6))).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });
});

// ---------------------------------------------------------------------------
// daemonToken server helpers
// ---------------------------------------------------------------------------

describe("dashboard daemon token helpers", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arc-dashboard-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("readDaemonRootToken returns null when auth.json is missing", () => {
    expect(readDaemonRootToken(tmp)).toBeNull();
  });

  it("readDaemonRootToken returns the token when auth.json is valid", () => {
    const token = "a".repeat(64);
    fs.writeFileSync(path.join(tmp, "auth.json"), JSON.stringify({ v: 1, rootToken: token }));
    expect(readDaemonRootToken(tmp)).toBe(token);
  });

  it("readDaemonRootToken rejects malformed / short tokens", () => {
    fs.writeFileSync(path.join(tmp, "auth.json"), JSON.stringify({ v: 1, rootToken: "short" }));
    expect(readDaemonRootToken(tmp)).toBeNull();
    fs.writeFileSync(path.join(tmp, "auth.json"), "{ not json");
    expect(readDaemonRootToken(tmp)).toBeNull();
  });

  it("isLocalRequest recognises loopback hosts and remote addresses", () => {
    // Fake IncomingMessage shapes — isLocalRequest only reads headers + socket.
    const make = (
      host: string | undefined,
      remoteAddress: string,
    ): import("node:http").IncomingMessage =>
      ({
        headers: host === undefined ? {} : { host },
        socket: { remoteAddress } as import("node:net").Socket,
      }) as unknown as import("node:http").IncomingMessage;

    expect(isLocalRequest(make("localhost:3700", "127.0.0.1"))).toBe(true);
    expect(isLocalRequest(make("127.0.0.1:3700", "127.0.0.1"))).toBe(true);
    expect(isLocalRequest(make("[::1]:3700", "::1"))).toBe(true);
    // No host header — falls back to remoteAddress.
    expect(isLocalRequest(make(undefined, "127.0.0.1"))).toBe(true);
    expect(isLocalRequest(make(undefined, "::ffff:127.0.0.1"))).toBe(true);
    // Non-loopback.
    expect(isLocalRequest(make("evil.example:3700", "203.0.113.7"))).toBe(false);
    expect(isLocalRequest(make(undefined, "203.0.113.7"))).toBe(false);
  });
});
