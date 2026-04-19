/**
 * React-Native-compatible minimal port of `@axiom-labs/arc-client`.
 *
 * The upstream SDK imports the Node `ws` library, which is not available in
 * React Native (Expo managed workflow). RN ships a browser-style
 * `global.WebSocket`, so we re-implement the small surface the mobile app
 * actually uses (connect, call, subscribe, attachTerminal) on top of it
 * while reusing the shared `protocol.ts` + `frame.ts` from the SDK.
 *
 * Proper cross-runtime packaging of `@axiom-labs/arc-client` (browser build,
 * conditional exports) is a Phase-4+ follow-up; this shim is intentionally
 * small and only covers what the scaffold needs.
 */
import {
  AgentListResult,
  AgentOkResult,
  AgentRunParams,
  AgentRunResult,
  AgentSendParams,
  AgentStopParams,
  AuthLoginResult,
  Channel,
  Envelope,
  HealthGetResult,
  Methods,
  ProfileListResult,
  type Envelope as EnvelopeT,
} from "@axiom-labs/arc-client";
import { decodeFrame, encodeControl } from "@axiom-labs/arc-client";
import type { z } from "zod";

export interface ArcClientOptions {
  url: string;
  token: string;
  reconnectBaseMs?: number;
  reconnectCapMs?: number;
  noReconnect?: boolean;
}

export type TopicHandler = (payload: unknown) => void;
export type TerminalHandler = (agentId: string, bytes: Uint8Array) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class ArcClient {
  private ws: WebSocket | null = null;
  private opts: Required<Omit<ArcClientOptions, "noReconnect">> & {
    noReconnect: boolean;
  };
  private pending = new Map<string, Pending>();
  private topicHandlers = new Map<string, Set<TopicHandler>>();
  private terminalHandler: TerminalHandler | null = null;
  private reconnectAttempt = 0;
  private closed = false;
  private idCounter = 0;

  constructor(options: ArcClientOptions) {
    this.opts = {
      url: options.url,
      token: options.token,
      reconnectBaseMs: options.reconnectBaseMs ?? 500,
      reconnectCapMs: options.reconnectCapMs ?? 15000,
      noReconnect: options.noReconnect ?? false,
    };
  }

  async connect(): Promise<void> {
    await this.openSocket();
    const result = await this.call(Methods.auth_login, {
      token: this.opts.token,
    });
    AuthLoginResult.parse(result);
    for (const topic of this.topicHandlers.keys()) {
      await this.sendSubscribe(topic);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }

  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */) {
      throw new Error("client not connected");
    }
    const id = this.nextId();
    const envelope: EnvelopeT = {
      v: 1,
      id,
      type: "request",
      method,
      params,
    };
    const frame = encodeControl(envelope);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.sendBinary(frame);
    });
  }

  async subscribe(topic: string, handler: TopicHandler): Promise<() => void> {
    let set = this.topicHandlers.get(topic);
    const first = !set;
    if (!set) {
      set = new Set();
      this.topicHandlers.set(topic, set);
    }
    set.add(handler);
    if (first) await this.sendSubscribe(topic);
    return async () => {
      set!.delete(handler);
      if (set!.size === 0) {
        this.topicHandlers.delete(topic);
        try {
          await this.sendUnsubscribe(topic);
        } catch {
          // already closed
        }
      }
    };
  }

  attachTerminal(handler: TerminalHandler | null): void {
    this.terminalHandler = handler;
  }

  health = (): Promise<z.infer<typeof HealthGetResult>> =>
    this.call(Methods.health_get).then((r) => HealthGetResult.parse(r));

  profiles = {
    list: (): Promise<z.infer<typeof ProfileListResult>> =>
      this.call(Methods.profile_list).then((r) => ProfileListResult.parse(r)),
    get: (name: string): Promise<unknown> =>
      this.call(Methods.profile_get, { name }),
  };

  agents = {
    list: (): Promise<z.infer<typeof AgentListResult>> =>
      this.call(Methods.agent_list).then((r) => AgentListResult.parse(r)),
    run: (
      params: z.infer<typeof AgentRunParams>,
    ): Promise<z.infer<typeof AgentRunResult>> =>
      this.call(Methods.agent_run, AgentRunParams.parse(params)).then((r) =>
        AgentRunResult.parse(r),
      ),
    stop: (
      params: z.infer<typeof AgentStopParams>,
    ): Promise<z.infer<typeof AgentOkResult>> =>
      this.call(Methods.agent_stop, AgentStopParams.parse(params)).then((r) =>
        AgentOkResult.parse(r),
      ),
    send: (
      params: z.infer<typeof AgentSendParams>,
    ): Promise<z.infer<typeof AgentOkResult>> =>
      this.call(Methods.agent_send, AgentSendParams.parse(params)).then((r) =>
        AgentOkResult.parse(r),
      ),
  };

  private nextId(): string {
    this.idCounter = (this.idCounter + 1) & 0xffffff;
    return `${Date.now().toString(36)}-${this.idCounter.toString(36)}`;
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      ws.binaryType = "arraybuffer";
      const onOpen = () => {
        ws.removeEventListener("error", onError);
        this.ws = ws;
        this.reconnectAttempt = 0;
        resolve();
      };
      const onError = (ev: Event) => {
        ws.removeEventListener("open", onOpen);
        const message =
          (ev as { message?: string }).message ?? "websocket error";
        reject(new Error(message));
      };
      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError);
      ws.addEventListener("message", (ev: MessageEvent) =>
        this.handleMessage(ev.data),
      );
      ws.addEventListener("close", () => this.handleClose());
    });
  }

  private handleMessage(raw: unknown): void {
    let buf: Uint8Array;
    if (raw instanceof ArrayBuffer) {
      buf = new Uint8Array(raw);
    } else if (raw instanceof Uint8Array) {
      buf = raw;
    } else {
      // RN may deliver string for text frames; we only expect binary.
      return;
    }
    let frame: ReturnType<typeof decodeFrame>;
    try {
      frame = decodeFrame(buf);
    } catch {
      return;
    }
    if (frame.channel === Channel.Control) {
      let envelope: EnvelopeT;
      try {
        envelope = Envelope.parse(
          JSON.parse(new TextDecoder().decode(frame.payload)),
        );
      } catch {
        return;
      }
      this.handleEnvelope(envelope);
      return;
    }
    if (frame.channel === Channel.Terminal && this.terminalHandler) {
      this.terminalHandler("", frame.payload);
    }
  }

  private handleEnvelope(envelope: EnvelopeT): void {
    if (envelope.type === "response" || envelope.type === "error") {
      const pending = this.pending.get(envelope.id);
      if (!pending) return;
      this.pending.delete(envelope.id);
      if (envelope.type === "error") {
        const err = new Error(envelope.message ?? "rpc error") as Error & {
          code?: string;
        };
        err.code = envelope.code;
        pending.reject(err);
      } else {
        pending.resolve(envelope.result);
      }
      return;
    }
    if (envelope.type === "event" && envelope.topic) {
      const set = this.topicHandlers.get(envelope.topic);
      if (!set) return;
      for (const h of set) h(envelope.payload);
    }
  }

  private handleClose(): void {
    this.ws = null;
    for (const [id, pending] of this.pending) {
      pending.reject(new Error("connection closed"));
      this.pending.delete(id);
    }
    if (this.closed || this.opts.noReconnect) return;
    const delay = Math.min(
      this.opts.reconnectCapMs,
      this.opts.reconnectBaseMs * 2 ** this.reconnectAttempt,
    );
    this.reconnectAttempt += 1;
    setTimeout(() => {
      this.connect().catch(() => {
        /* will loop back via handleClose */
      });
    }, delay);
  }

  private sendSubscribe(topic: string): Promise<void> {
    return this.sendTopicOp("subscribe", topic);
  }

  private sendUnsubscribe(topic: string): Promise<void> {
    return this.sendTopicOp("unsubscribe", topic);
  }

  private sendTopicOp(
    type: "subscribe" | "unsubscribe",
    topic: string,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== 1) return Promise.resolve();
    const id = this.nextId();
    const frame = encodeControl({ v: 1, id, type, topic });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: () => resolve(), reject });
      this.sendBinary(frame);
    });
  }

  /** RN's WebSocket accepts ArrayBuffer but not Uint8Array views. */
  private sendBinary(frame: Uint8Array): void {
    this.ws!.send(
      frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength),
    );
  }
}
