import { Channel, type ChannelId } from "./protocol.js";

/**
 * Binary frame format:
 *
 *   ┌────┬──────┬────────────┬──────────────────┐
 *   │ ch │ flag │ len (u32be)│ payload (N bytes)│
 *   │ 1B │ 1B   │ 4B         │                  │
 *   └────┴──────┴────────────┴──────────────────┘
 *
 * We transport this as a single WebSocket binary message — one frame per
 * message. WebSocket already does its own length-prefixing, but we keep
 * our own `len` so the format is self-describing if we ever move off WS
 * (TCP, relay channels, etc.).
 */
export interface Frame {
  channel: ChannelId;
  flags: number;
  payload: Uint8Array;
}

export function encodeFrame(frame: Frame): Uint8Array {
  const len = frame.payload.length;
  const out = new Uint8Array(6 + len);
  out[0] = frame.channel;
  out[1] = frame.flags & 0xff;
  // length big-endian
  out[2] = (len >>> 24) & 0xff;
  out[3] = (len >>> 16) & 0xff;
  out[4] = (len >>> 8) & 0xff;
  out[5] = len & 0xff;
  out.set(frame.payload, 6);
  return out;
}

export function decodeFrame(buf: Uint8Array): Frame {
  if (buf.length < 6) throw new Error("frame too short");
  const channel = buf[0] as ChannelId;
  const flags = buf[1]!;
  const len = (buf[2]! << 24) | (buf[3]! << 16) | (buf[4]! << 8) | buf[5]!;
  if (buf.length < 6 + len) throw new Error("frame truncated");
  const payload = buf.subarray(6, 6 + len);
  return { channel, flags, payload };
}

export function encodeControl(obj: unknown): Uint8Array {
  const json = JSON.stringify(obj);
  const payload = new TextEncoder().encode(json);
  return encodeFrame({ channel: Channel.Control, flags: 0, payload });
}

export function decodeControl(payload: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(payload));
}
