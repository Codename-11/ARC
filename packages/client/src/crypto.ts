/**
 * NaCl-box crypto primitives used by the ARC v3 pairing / relay flow.
 *
 * Wraps `tweetnacl` so that both the daemon (seal/unseal) and the client
 * (seal/unseal) can share a single implementation. Uses Curve25519 for
 * key agreement, XSalsa20 for encryption, and Poly1305 for authentication
 * (i.e. `crypto_box` / `crypto_box_open`).
 *
 * This module is **primitives only** — it is deliberately decoupled from
 * the daemon WS handshake and from the relay server so it can be audited
 * and reused in follow-up batches.
 */

import nacl from "tweetnacl";

// ─── Keypair ─────────────────────────────────────────────────────────

export interface KeyPair {
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
}

/** Generate a fresh Curve25519 keypair. */
export function generateKeypair(): KeyPair {
  const kp = nacl.box.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

// ─── Sealing ─────────────────────────────────────────────────────────

export interface SealedMessage {
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

/**
 * Encrypt + authenticate `plaintext` for `theirPublic` using `mySecret`.
 * Returns the nonce alongside the ciphertext; both must be transmitted.
 */
export function box(
  plaintext: Uint8Array,
  theirPublic: Uint8Array,
  mySecret: Uint8Array,
): SealedMessage {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(plaintext, nonce, theirPublic, mySecret);
  return { nonce, ciphertext };
}

/**
 * Decrypt + verify `ciphertext` sealed with `box`.
 * Returns `null` on authentication failure (tampered or wrong keys).
 */
export function unbox(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  theirPublic: Uint8Array,
  mySecret: Uint8Array,
): Uint8Array | null {
  const opened = nacl.box.open(ciphertext, nonce, theirPublic, mySecret);
  return opened ?? null;
}

// ─── URL-safe base64 ────────────────────────────────────────────────
//
// RFC 4648 §5 (base64url, no padding). Used for keys, nonces, and the
// compact pairing payload so it can ride inside QR codes / URLs
// without percent-encoding.

export function encodeB64(u8: Uint8Array): string {
  const bin = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString(
    "base64",
  );
  return bin.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeB64(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const buf = Buffer.from(padded + pad, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
