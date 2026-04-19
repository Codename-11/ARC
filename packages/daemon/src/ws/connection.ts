import type { Duplex } from "node:stream";
import {
  OPCODE_BINARY,
  OPCODE_CLOSE,
  OPCODE_CONT,
  OPCODE_PING,
  OPCODE_PONG,
  OPCODE_TEXT,
  encodeFrame as encodeWsFrame,
  parseFrames,
} from "./frame.js";

export type MessageKind = "binary" | "text";

export interface WsConnection {
  send(kind: MessageKind, payload: Uint8Array | string): void;
  close(code?: number): void;
  onMessage: ((kind: MessageKind, payload: Buffer) => void) | null;
  onClose: (() => void) | null;
  alive: boolean;
}

export function createWsConnection(socket: Duplex): WsConnection {
  let buf: Buffer = Buffer.alloc(0);
  let fragments: Buffer[] = [];
  let fragmentOpcode: number | null = null;

  const conn: WsConnection = {
    alive: true,
    onMessage: null,
    onClose: null,
    send(kind, payload) {
      const bytes =
        typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload);
      const opcode = kind === "binary" ? OPCODE_BINARY : OPCODE_TEXT;
      try {
        socket.write(encodeWsFrame(opcode, bytes));
      } catch {
        conn.alive = false;
      }
    },
    close(code = 1000) {
      if (!conn.alive) return;
      conn.alive = false;
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code, 0);
      try {
        socket.write(encodeWsFrame(OPCODE_CLOSE, payload));
      } catch {
        // ignore
      }
      socket.end();
    },
  };

  socket.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    let parsed: ReturnType<typeof parseFrames>;
    try {
      parsed = parseFrames(buf);
    } catch {
      conn.close(1002);
      return;
    }
    buf = Buffer.from(parsed.rest);
    for (const frame of parsed.frames) {
      handleFrame(frame.opcode, frame.fin, frame.payload);
    }
  });

  socket.on("close", () => {
    conn.alive = false;
    conn.onClose?.();
  });
  socket.on("error", () => {
    conn.alive = false;
  });

  function handleFrame(opcode: number, fin: boolean, payload: Buffer): void {
    if (opcode === OPCODE_CLOSE) {
      conn.close();
      return;
    }
    if (opcode === OPCODE_PING) {
      try {
        socket.write(encodeWsFrame(OPCODE_PONG, payload));
      } catch {
        conn.alive = false;
      }
      return;
    }
    if (opcode === OPCODE_PONG) return;

    if (opcode === OPCODE_TEXT || opcode === OPCODE_BINARY) {
      if (fin) {
        deliver(opcode, payload);
      } else {
        fragments = [payload];
        fragmentOpcode = opcode;
      }
      return;
    }
    if (opcode === OPCODE_CONT) {
      fragments.push(payload);
      if (fin && fragmentOpcode !== null) {
        const full = Buffer.concat(fragments);
        const op = fragmentOpcode;
        fragments = [];
        fragmentOpcode = null;
        deliver(op, full);
      }
    }
  }

  function deliver(opcode: number, payload: Buffer): void {
    const kind: MessageKind = opcode === OPCODE_BINARY ? "binary" : "text";
    conn.onMessage?.(kind, payload);
  }

  return conn;
}
