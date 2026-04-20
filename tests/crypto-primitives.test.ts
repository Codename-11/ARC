import { describe, it, expect } from "vitest";
import {
  generateKeypair,
  box,
  unbox,
  encodeB64,
  decodeB64,
  encodePairingPayload,
  decodePairingPayload,
  PairingPayload,
} from "../packages/client/src/index.js";

// ─── Keypair ─────────────────────────────────────────────────────────

describe("generateKeypair", () => {
  it("produces 32-byte public and secret keys", () => {
    const kp = generateKeypair();
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.secretKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey.length).toBe(32);
    expect(kp.secretKey.length).toBe(32);
  });

  it("returns a distinct keypair on each call", () => {
    const a = generateKeypair();
    const b = generateKeypair();
    expect(Buffer.from(a.publicKey).equals(Buffer.from(b.publicKey))).toBe(false);
    expect(Buffer.from(a.secretKey).equals(Buffer.from(b.secretKey))).toBe(false);
  });
});

// ─── box / unbox ─────────────────────────────────────────────────────

describe("box / unbox", () => {
  it("roundtrips a plaintext between two parties", () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const plaintext = new TextEncoder().encode("hello from alice");

    const { nonce, ciphertext } = box(plaintext, bob.publicKey, alice.secretKey);
    const opened = unbox(ciphertext, nonce, alice.publicKey, bob.secretKey);

    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened!)).toBe("hello from alice");
  });

  it("uses a fresh random nonce on each call", () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const msg = new TextEncoder().encode("same message");

    const a = box(msg, bob.publicKey, alice.secretKey);
    const b = box(msg, bob.publicKey, alice.secretKey);

    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });

  it("returns null for tampered ciphertext", () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const plaintext = new TextEncoder().encode("please don't tamper");

    const { nonce, ciphertext } = box(plaintext, bob.publicKey, alice.secretKey);
    const tampered = new Uint8Array(ciphertext);
    tampered[tampered.length - 1] ^= 0x01;

    const opened = unbox(tampered, nonce, alice.publicKey, bob.secretKey);
    expect(opened).toBeNull();
  });

  it("returns null when the nonce is wrong", () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const plaintext = new TextEncoder().encode("wrong nonce");

    const { ciphertext } = box(plaintext, bob.publicKey, alice.secretKey);
    const badNonce = new Uint8Array(24); // all zeroes

    const opened = unbox(ciphertext, badNonce, alice.publicKey, bob.secretKey);
    expect(opened).toBeNull();
  });

  it("returns null when the recipient key is wrong", () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const mallory = generateKeypair();
    const plaintext = new TextEncoder().encode("not for mallory");

    const { nonce, ciphertext } = box(plaintext, bob.publicKey, alice.secretKey);
    const opened = unbox(ciphertext, nonce, alice.publicKey, mallory.secretKey);
    expect(opened).toBeNull();
  });
});

// ─── base64url ───────────────────────────────────────────────────────

describe("encodeB64 / decodeB64", () => {
  it("roundtrips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = encodeB64(bytes);
    const decoded = decodeB64(encoded);
    expect(Buffer.from(decoded).equals(Buffer.from(bytes))).toBe(true);
  });

  it("is URL-safe (no '+', '/', or '=' in output)", () => {
    // 0xFB,0xFF,0xBF encodes to "+/+/" in standard base64 → forces replacements
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0xfb, 0xef]);
    const encoded = encodeB64(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

// ─── Pairing payload ─────────────────────────────────────────────────

describe("pairing payload", () => {
  const sample: PairingPayload = {
    v: 1,
    relayUrl: "wss://relay.example.com",
    daemonPub: encodeB64(generateKeypair().publicKey),
    pairCode: "A1B2C3",
    label: "bailey-laptop",
  };

  it("encode/decode roundtrip preserves fields", () => {
    const encoded = encodePairingPayload(sample);
    expect(typeof encoded).toBe("string");
    expect(encoded).not.toMatch(/[+/=]/);

    const decoded = decodePairingPayload(encoded);
    expect(decoded).toEqual(sample);
  });

  it("omits the optional label when absent", () => {
    const { label: _omit, ...rest } = sample;
    const payload: PairingPayload = { ...rest };
    const decoded = decodePairingPayload(encodePairingPayload(payload));
    expect(decoded.label).toBeUndefined();
    expect(decoded).toEqual(payload);
  });

  it("throws on malformed base64", () => {
    expect(() => decodePairingPayload("!!!not-base64!!!")).toThrow();
  });

  it("throws on base64 that decodes to non-JSON", () => {
    const junk = encodeB64(new TextEncoder().encode("not json at all"));
    expect(() => decodePairingPayload(junk)).toThrow(/invalid JSON/);
  });

  it("throws on schema violations (missing fields)", () => {
    const bad = encodeB64(
      new TextEncoder().encode(JSON.stringify({ v: 1, relayUrl: "wss://x" })),
    );
    expect(() => decodePairingPayload(bad)).toThrow();
  });

  it("throws on wrong schema version", () => {
    const bad = encodeB64(
      new TextEncoder().encode(
        JSON.stringify({ ...sample, v: 2 }),
      ),
    );
    expect(() => decodePairingPayload(bad)).toThrow();
  });
});
