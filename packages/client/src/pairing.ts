/**
 * Pairing payload schema used by ARC v3 QR-based device linking.
 *
 * The daemon renders a QR (or displays a URL) containing the encoded
 * payload. The client scans/decodes it, derives the relay URL + daemon
 * public key, and initiates an E2E-encrypted session via the relay.
 *
 * This module is **schema + codec only** — it does not generate QR
 * images or talk to the relay. Those are built in follow-up batches.
 */

import { z } from "zod";
import { decodeB64, encodeB64 } from "./crypto.js";

// ─── Schema ───────────────────────────────────────────────────────────

export const PairingPayload = z.object({
  /** Schema version — bump when the shape changes incompatibly. */
  v: z.literal(1),
  /** Relay WebSocket URL the client should dial (e.g. wss://relay.example.com). */
  relayUrl: z.string(),
  /** Daemon's long-lived NaCl-box public key, base64url. */
  daemonPub: z.string(),
  /** Short random code scoped to this pairing attempt (5-minute TTL on the relay). */
  pairCode: z.string(),
  /** Optional human-readable label for the daemon (hostname, nickname, …). */
  label: z.string().optional(),
});

export type PairingPayload = z.infer<typeof PairingPayload>;

// ─── Codec ────────────────────────────────────────────────────────────
//
// The on-wire form is a single URL-safe base64 string wrapping the
// compact JSON. We keep the JSON canonical (sorted keys) so the same
// payload always encodes to the same string, which makes pairing codes
// diff-able and cache-friendly.

function canonicalize(p: PairingPayload): string {
  const ordered: Record<string, unknown> = {
    v: p.v,
    relayUrl: p.relayUrl,
    daemonPub: p.daemonPub,
    pairCode: p.pairCode,
  };
  if (p.label !== undefined) ordered.label = p.label;
  return JSON.stringify(ordered);
}

/** Encode a validated pairing payload as a single URL-safe string. */
export function encodePairingPayload(p: PairingPayload): string {
  const parsed = PairingPayload.parse(p);
  const json = canonicalize(parsed);
  return encodeB64(new TextEncoder().encode(json));
}

/**
 * Decode + validate a pairing payload string.
 * Throws on malformed base64, malformed JSON, or schema violations.
 */
export function decodePairingPayload(s: string): PairingPayload {
  let json: string;
  try {
    json = new TextDecoder().decode(decodeB64(s));
  } catch (err) {
    throw new Error(
      `pairing payload: invalid base64url (${(err as Error).message})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `pairing payload: invalid JSON (${(err as Error).message})`,
    );
  }

  return PairingPayload.parse(parsed);
}
