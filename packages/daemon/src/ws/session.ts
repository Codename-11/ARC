import crypto from "node:crypto";
import type { WsConnection } from "./connection.js";
import {
  Channel,
  Envelope,
  decodeControl,
  decodeFrame,
  encodeControl,
  encodeFrame,
  type ChannelId,
  type Envelope as EnvelopeT,
} from "@axiom-labs/arc-client";
import { encodeTerminalPayload } from "../terminal-frame.js";

export type EventSink = (envelope: EnvelopeT) => void;

export class Session {
  readonly id: string;
  readonly subs = new Set<string>();
  authenticated = false;
  clientId = "";
  clientLabel: string | null = null;

  constructor(public readonly conn: WsConnection) {
    this.id = crypto.randomUUID();
  }

  sendControl(envelope: EnvelopeT): void {
    this.conn.send("binary", encodeControl(envelope));
  }

  /**
   * Send raw terminal bytes on channel 1. The payload is prefixed with a
   * 36-byte agent UUID so multiplexed streams can be routed per-agent
   * client-side.
   */
  sendTerminal(agentId: string, bytes: Uint8Array): void {
    const payload = encodeTerminalPayload(agentId, bytes);
    this.conn.send("binary", encodeFrame({ channel: Channel.Terminal, flags: 0, payload }));
  }

  close(code = 1000): void {
    this.conn.close(code);
  }
}

export interface DecodedControl {
  channel: typeof Channel.Control;
  envelope: EnvelopeT;
  payload: Uint8Array;
}
export interface DecodedNonControl {
  channel: ChannelId;
  payload: Uint8Array;
}

export function receiveBinary(data: Buffer): DecodedControl | DecodedNonControl {
  const frame = decodeFrame(data);
  if (frame.channel === Channel.Control) {
    const raw = decodeControl(frame.payload);
    const envelope = Envelope.parse(raw);
    return { channel: Channel.Control, envelope, payload: frame.payload };
  }
  return { channel: frame.channel, payload: frame.payload };
}
