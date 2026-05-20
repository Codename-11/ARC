import WebSocket from "ws";
import { z } from "zod";
import {
  AgentAttachParams,
  AgentAttachResult,
  AgentEventPayload,
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
  type ChannelId,
  type Envelope as EnvelopeT,
} from "./protocol.js";
import { decodeFrame, encodeControl, encodeFrame } from "./frame.js";

/** Length (in bytes) of the agent UUID prefix on terminal frames. */
const TERMINAL_ID_LEN = 36;

export interface ArcClientOptions {
  /** WebSocket URL, e.g. `ws://127.0.0.1:7272`. */
  url: string;
  /** Shared secret or per-client token. */
  token: string;
  /** Reconnect backoff base in ms (default 500). */
  reconnectBaseMs?: number;
  /** Reconnect backoff cap in ms (default 15000). */
  reconnectCapMs?: number;
  /** Disable auto-reconnect (useful for one-shot CLI). */
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
  private opts: Required<Omit<ArcClientOptions, "noReconnect">> & { noReconnect: boolean };
  private pending = new Map<string, Pending>();
  private topicHandlers = new Map<string, Set<TopicHandler>>();
  private terminalHandler: TerminalHandler | null = null;
  private agentTerminalHandlers = new Map<string, TerminalHandler>();
  private reconnectAttempt = 0;
  private closed = false;
  private idCounter = 0;
  private sessionId: string | null = null;

  constructor(options: ArcClientOptions) {
    this.opts = {
      url: options.url,
      token: options.token,
      reconnectBaseMs: options.reconnectBaseMs ?? 500,
      reconnectCapMs: options.reconnectCapMs ?? 15000,
      noReconnect: options.noReconnect ?? false,
    };
  }

  /** Open connection + authenticate. Resolves after the login RPC returns. */
  async connect(): Promise<void> {
    await this.openSocket();
    const result = await this.call(Methods.auth_login, { token: this.opts.token });
    const parsed = AuthLoginResult.parse(result);
    this.sessionId = parsed.sessionId;
    // Resubscribe any topics from before reconnect.
    for (const topic of this.topicHandlers.keys()) {
      await this.sendSubscribe(topic);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.agentTerminalHandlers.clear();
  }

  /** Typed request/response RPC. */
  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("client not connected");
    }
    const id = this.nextId();
    const envelope: EnvelopeT = { v: 1, id, type: "request", method, params };
    const frame = encodeControl(envelope);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.ws!.send(frame);
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
          // connection already closed — nothing to unsubscribe on server side
        }
      }
    };
  }

  /** Set a handler for raw terminal channel bytes. One at a time (last wins). */
  attachTerminal(handler: TerminalHandler | null): void {
    this.terminalHandler = handler;
  }

  // --- Typed domain wrappers ----------------------------------------------

  health = (): Promise<z.infer<typeof HealthGetResult>> =>
    this.call(Methods.health_get).then((r) => HealthGetResult.parse(r));

  profiles = {
    list: (): Promise<z.infer<typeof ProfileListResult>> =>
      this.call(Methods.profile_list).then((r) => ProfileListResult.parse(r)),
    get: (name: string): Promise<unknown> => this.call(Methods.profile_get, { name }),
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
    stop: (params: z.infer<typeof AgentStopParams>): Promise<z.infer<typeof AgentOkResult>> =>
      this.call(Methods.agent_stop, AgentStopParams.parse(params)).then((r) =>
        AgentOkResult.parse(r),
      ),
    send: (params: z.infer<typeof AgentSendParams>): Promise<z.infer<typeof AgentOkResult>> =>
      this.call(Methods.agent_send, AgentSendParams.parse(params)).then((r) =>
        AgentOkResult.parse(r),
      ),
    /**
     * Subscribe to `agent:<id>` events and route terminal bytes for that id
     * to `onTerminal`. Returns the initial replay + a dispose function.
     */
    attach: async (
      agentId: string,
      handlers: {
        onEvent?: (event: z.infer<typeof AgentEventPayload>) => void;
        onTerminal?: TerminalHandler;
      } = {},
      attachParams: Omit<z.infer<typeof AgentAttachParams>, "agentId"> = {},
    ): Promise<{ initial: z.infer<typeof AgentAttachResult>; dispose: () => Promise<void> }> => {
      const initial = AgentAttachResult.parse(
        await this.call(
          Methods.agent_attach,
          AgentAttachParams.parse({ agentId, ...attachParams }),
        ),
      );
      const topic = `agent:${agentId}`;
      const unsubEvents = await this.subscribe(topic, (payload) => {
        if (handlers.onEvent) {
          handlers.onEvent(payload as z.infer<typeof AgentEventPayload>);
        }
      });
      if (handlers.onTerminal) {
        this.agentTerminalHandlers.set(agentId, handlers.onTerminal);
      }
      return {
        initial,
        dispose: async () => {
          await unsubEvents();
          this.agentTerminalHandlers.delete(agentId);
        },
      };
    },
  };

  // --- Internals -----------------------------------------------------------

  private nextId(): string {
    this.idCounter = (this.idCounter + 1) & 0xffffff;
    return `${Date.now().toString(36)}-${this.idCounter.toString(36)}`;
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      ws.binaryType = "arraybuffer";
      const onOpen = () => {
        ws.off("error", onError);
        this.ws = ws;
        this.reconnectAttempt = 0;
        resolve();
      };
      const onError = (err: Error) => {
        ws.off("open", onOpen);
        reject(err);
      };
      ws.once("open", onOpen);
      ws.once("error", onError);
      ws.on("message", (data: WebSocket.RawData) => this.handleMessage(data));
      ws.on("close", () => this.handleClose());
    });
  }

  private handleMessage(raw: WebSocket.RawData): void {
    let buf: Uint8Array;
    if (raw instanceof ArrayBuffer) buf = new Uint8Array(raw);
    else if (Array.isArray(raw)) buf = Buffer.concat(raw);
    else buf = new Uint8Array(raw as Buffer);
    let frame: ReturnType<typeof decodeFrame>;
    try {
      frame = decodeFrame(buf);
    } catch {
      return;
    }
    if (frame.channel === Channel.Control) {
      let envelope: EnvelopeT;
      try {
        envelope = Envelope.parse(JSON.parse(new TextDecoder().decode(frame.payload)));
      } catch {
        return;
      }
      this.handleEnvelope(envelope);
      return;
    }
    if (frame.channel === Channel.Terminal) {
      // Terminal frames are prefixed with a 36-byte ASCII UUID identifying
      // the source agent, followed by raw bytes.
      const payload = frame.payload;
      const agentId =
        payload.length >= TERMINAL_ID_LEN
          ? new TextDecoder().decode(payload.subarray(0, TERMINAL_ID_LEN))
          : "";
      const bytes =
        payload.length >= TERMINAL_ID_LEN ? payload.subarray(TERMINAL_ID_LEN) : payload;
      const perAgent = this.agentTerminalHandlers.get(agentId);
      if (perAgent) perAgent(agentId, bytes);
      if (this.terminalHandler) this.terminalHandler(agentId, bytes);
    }
  }

  private handleEnvelope(envelope: EnvelopeT): void {
    if (envelope.type === "response" || envelope.type === "error") {
      const pending = this.pending.get(envelope.id);
      if (!pending) return;
      this.pending.delete(envelope.id);
      if (envelope.type === "error") {
        const err = new Error(envelope.message ?? "rpc error") as Error & { code?: string };
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

  private async sendSubscribe(topic: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: () => resolve(), reject });
      this.ws!.send(encodeControl({ v: 1, id, type: "subscribe", topic }));
    });
  }

  private async sendUnsubscribe(topic: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: () => resolve(), reject });
      this.ws!.send(encodeControl({ v: 1, id, type: "unsubscribe", topic }));
    });
  }
}
