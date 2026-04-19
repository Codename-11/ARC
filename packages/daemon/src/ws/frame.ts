import crypto from "node:crypto";
import type { Duplex } from "node:stream";

export const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export const OPCODE_CONT = 0x00;
export const OPCODE_TEXT = 0x01;
export const OPCODE_BINARY = 0x02;
export const OPCODE_CLOSE = 0x08;
export const OPCODE_PING = 0x09;
export const OPCODE_PONG = 0x0a;

export function acceptKey(clientKey: string): string {
  return crypto.createHash("sha1").update(clientKey + WS_MAGIC).digest("base64");
}

export function encodeFrame(opcode: number, payload: Uint8Array): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, Buffer.from(payload)]);
}

export interface DecodedFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}

/**
 * Simple streaming frame parser. Maintains a rolling buffer and pulls out
 * complete frames. Returns the list of fully-decoded frames and the leftover
 * bytes that should be carried into the next call.
 */
export function parseFrames(buf: Buffer): { frames: DecodedFrame[]; rest: Buffer } {
  const frames: DecodedFrame[] = [];
  let cursor = 0;
  while (buf.length - cursor >= 2) {
    const b0 = buf[cursor]!;
    const b1 = buf[cursor + 1]!;
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let headerLen = 2;
    if (len === 126) {
      if (buf.length - cursor < 4) break;
      len = buf.readUInt16BE(cursor + 2);
      headerLen = 4;
    } else if (len === 127) {
      if (buf.length - cursor < 10) break;
      const bigLen = buf.readBigUInt64BE(cursor + 2);
      if (bigLen > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("frame too large");
      }
      len = Number(bigLen);
      headerLen = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length - cursor < headerLen + maskLen + len) break;
    let payload: Buffer;
    if (masked) {
      const mask = buf.subarray(cursor + headerLen, cursor + headerLen + 4);
      const data = Buffer.from(buf.subarray(cursor + headerLen + 4, cursor + headerLen + 4 + len));
      for (let i = 0; i < data.length; i++) {
        data[i] ^= mask[i & 3]!;
      }
      payload = data;
    } else {
      payload = Buffer.from(buf.subarray(cursor + headerLen, cursor + headerLen + len));
    }
    frames.push({ fin, opcode, payload });
    cursor += headerLen + maskLen + len;
  }
  return { frames, rest: buf.subarray(cursor) };
}

export function writeHandshakeResponse(socket: Duplex, key: string): void {
  const accept = acceptKey(key);
  const response = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n",
  ].join("\r\n");
  socket.write(response);
}
