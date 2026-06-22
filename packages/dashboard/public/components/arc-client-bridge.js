// ARC Dashboard — Daemon WebSocket Bridge
//
// Tiny vanilla-JS shim that speaks the same binary-mux protocol as
// `@axiom-labs/arc-client` (see packages/client/src/frame.ts +
// packages/client/src/protocol.ts). Loaded as an ES module from
// index.html; also exposes `window.ArcClient` for non-module callers.
//
// Frame layout (matches packages/client/src/frame.ts):
//
//   ┌────┬──────┬────────────┬──────────────────┐
//   │ ch │ flag │ len (u32be)│ payload (N bytes)│
//   │ 1B │ 1B   │ 4B         │                  │
//   └────┴──────┴────────────┴──────────────────┘
//
// Control envelopes (channel 0) are JSON:
//   { v:1, id, type:"request"|"response"|"event"|"subscribe"|"unsubscribe"|"error",
//     method?, params?, result?, topic?, payload?, code?, message? }

export const Channel = Object.freeze({
  Control: 0x00,
  Terminal: 0x01,
  File: 0x02,
  Audio: 0x03,
});

export const PROTOCOL_VERSION = 1;

// --- Frame codec -----------------------------------------------------------

export function encodeFrame(channel, flags, payload) {
  const len = payload.length;
  const out = new Uint8Array(6 + len);
  out[0] = channel & 0xff;
  out[1] = flags & 0xff;
  out[2] = (len >>> 24) & 0xff;
  out[3] = (len >>> 16) & 0xff;
  out[4] = (len >>> 8) & 0xff;
  out[5] = len & 0xff;
  out.set(payload, 6);
  return out;
}

export function decodeFrame(buf) {
  if (buf.length < 6) throw new Error('frame too short');
  const channel = buf[0];
  const flags = buf[1];
  const len = (buf[2] << 24) | (buf[3] << 16) | (buf[4] << 8) | buf[5];
  if (buf.length < 6 + len) throw new Error('frame truncated');
  return { channel, flags, payload: buf.subarray(6, 6 + len) };
}

export function encodeControl(obj) {
  const json = JSON.stringify(obj);
  const payload = new TextEncoder().encode(json);
  return encodeFrame(Channel.Control, 0, payload);
}

export function decodeControlPayload(payload) {
  return JSON.parse(new TextDecoder().decode(payload));
}

// --- Client ----------------------------------------------------------------

class ArcClientBridge {
  constructor() {
    this._ws = null;
    this._pending = new Map();
    this._topicHandlers = new Map();
    this._terminalHandler = null;
    this._idCounter = 0;
    this._url = null;
    this._token = null;
    this._connected = false;
    this._closed = false;
    this._reconnectTimer = null;
    this._reconnectAttempt = 0;
  }

  /**
   * Open a WebSocket to the dashboard `/ws` proxy (preferred) or the
   * supplied URL, then authenticate with `token`.
   * Returns a promise that resolves once the login RPC succeeds.
   */
  async connect(token, url) {
    if (this._connected) return;
    this._token = token || null;
    this._url = url || this._defaultUrl();
    this._closed = false;
    await this._openSocket(this._url);
    if (this._token) {
      try {
        await this._callRaw('auth.login', { token: this._token });
      } catch (err) {
        this._connected = false;
        this._ws?.close();
        this._ws = null;
        throw err;
      }
    }
    this._connected = true;
    // Resubscribe after reconnect.
    for (const topic of this._topicHandlers.keys()) {
      try {
        await this._sendSubscribe(topic);
      } catch {
        /* best effort */
      }
    }
  }

  close() {
    this._closed = true;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    if (this._ws) {
      try {
        this._ws.close();
      } catch {
        /* ignore */
      }
    }
    this._ws = null;
    this._connected = false;
  }

  /** RPC call — returns a promise resolving to the result. */
  async call(method, params) {
    if (!this._ws || this._ws.readyState !== 1 /* OPEN */) {
      throw new Error('ArcClient: not connected');
    }
    return this._callRaw(method, params);
  }

  /** Subscribe to a topic. Returns an async unsubscribe function. */
  async subscribe(topic, handler) {
    let set = this._topicHandlers.get(topic);
    const first = !set;
    if (!set) {
      set = new Set();
      this._topicHandlers.set(topic, set);
    }
    set.add(handler);
    if (first) await this._sendSubscribe(topic);
    return async () => {
      set.delete(handler);
      if (set.size === 0) {
        this._topicHandlers.delete(topic);
        try {
          await this._sendUnsubscribe(topic);
        } catch {
          /* connection closed — no-op */
        }
      }
    };
  }

  attachTerminal(handler) {
    this._terminalHandler = handler || null;
  }

  isConnected() {
    return this._connected && this._ws?.readyState === 1;
  }

  // --- Internals ----------------------------------------------------------

  _defaultUrl() {
    const loc = globalThis.location;
    if (loc) {
      const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
      return `${proto}://${loc.host}/ws`;
    }
    return 'ws://127.0.0.1:7272';
  }

  _nextId() {
    this._idCounter = (this._idCounter + 1) & 0xffffff;
    return `${Date.now().toString(36)}-${this._idCounter.toString(36)}`;
  }

  _openSocket(url) {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        // Signal to the dashboard server that this upgrade should be
        // proxied to the daemon (vs. handed to the legacy text-frame WS).
        ws = new WebSocket(url, ['arc-daemon']);
      } catch (err) {
        reject(err);
        return;
      }
      ws.binaryType = 'arraybuffer';
      const onOpen = () => {
        ws.removeEventListener('error', onError);
        this._ws = ws;
        this._reconnectAttempt = 0;
        resolve();
      };
      const onError = (ev) => {
        ws.removeEventListener('open', onOpen);
        reject(new Error(`WebSocket error: ${ev?.message || 'failed to connect'}`));
      };
      ws.addEventListener('open', onOpen, { once: true });
      ws.addEventListener('error', onError, { once: true });
      ws.addEventListener('message', (ev) => this._handleMessage(ev.data));
      ws.addEventListener('close', () => this._handleClose());
    });
  }

  _handleMessage(data) {
    let buf;
    if (data instanceof ArrayBuffer) {
      buf = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
      buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else {
      // Text frame — ignore; protocol is binary.
      return;
    }
    let frame;
    try {
      frame = decodeFrame(buf);
    } catch {
      return;
    }
    if (frame.channel === Channel.Control) {
      let envelope;
      try {
        envelope = decodeControlPayload(frame.payload);
      } catch {
        return;
      }
      this._handleEnvelope(envelope);
      return;
    }
    if (frame.channel === Channel.Terminal && this._terminalHandler) {
      this._terminalHandler('', frame.payload);
    }
  }

  _handleEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object') return;
    if (envelope.type === 'response' || envelope.type === 'error') {
      const pending = this._pending.get(envelope.id);
      if (!pending) return;
      this._pending.delete(envelope.id);
      if (envelope.type === 'error') {
        const err = new Error(envelope.message || 'rpc error');
        err.code = envelope.code;
        pending.reject(err);
      } else {
        pending.resolve(envelope.result);
      }
      return;
    }
    if (envelope.type === 'event' && envelope.topic) {
      const set = this._topicHandlers.get(envelope.topic);
      if (!set) return;
      for (const h of set) {
        try { h(envelope.payload); } catch { /* swallow handler errors */ }
      }
    }
  }

  _handleClose() {
    this._ws = null;
    this._connected = false;
    for (const [id, pending] of this._pending) {
      pending.reject(new Error('connection closed'));
      this._pending.delete(id);
    }
    if (this._closed || !this._token) return;
    // Exponential backoff, capped at 15s.
    const delay = Math.min(15000, 500 * 2 ** this._reconnectAttempt);
    this._reconnectAttempt += 1;
    this._reconnectTimer = setTimeout(() => {
      this.connect(this._token, this._url).catch(() => {
        /* next close will retry */
      });
    }, delay);
  }

  _callRaw(method, params) {
    const id = this._nextId();
    const envelope = { v: PROTOCOL_VERSION, id, type: 'request', method, params };
    const frame = encodeControl(envelope);
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      try {
        this._ws.send(frame);
      } catch (err) {
        this._pending.delete(id);
        reject(err);
      }
    });
  }

  _sendSubscribe(topic) {
    const id = this._nextId();
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve: () => resolve(), reject });
      try {
        this._ws.send(encodeControl({ v: PROTOCOL_VERSION, id, type: 'subscribe', topic }));
      } catch (err) {
        this._pending.delete(id);
        reject(err);
      }
    });
  }

  _sendUnsubscribe(topic) {
    const id = this._nextId();
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve: () => resolve(), reject });
      try {
        this._ws.send(encodeControl({ v: PROTOCOL_VERSION, id, type: 'unsubscribe', topic }));
      } catch (err) {
        this._pending.delete(id);
        reject(err);
      }
    });
  }
}

// --- Module singleton + bootstrap ------------------------------------------

const bridge = new ArcClientBridge();

/**
 * Lazy initializer — fetches the daemon token from the dashboard and opens
 * the WebSocket. Returns the shared bridge instance once connected, or
 * `null` if the daemon isn't reachable (HTTP fallback should kick in).
 *
 * Failures (token missing, WS refused, etc.) resolve to `null` without
 * caching, so a later render can retry once the daemon comes up. A live
 * connection IS cached — subsequent callers get the same bridge cheaply.
 */
let livePromise = null;
export function ensureArcClient() {
  if (bridge.isConnected()) return Promise.resolve(bridge);
  if (livePromise) return livePromise;
  livePromise = (async () => {
    try {
      const res = await fetch('/api/daemon-token');
      if (!res.ok) return null;
      const body = await res.json();
      if (!body || typeof body.token !== 'string') return null;
      await bridge.connect(body.token);
      return bridge;
    } catch {
      return null;
    } finally {
      // Allow retry on the next call regardless of outcome; a successful
      // connection short-circuits above via `bridge.isConnected()`.
      livePromise = null;
    }
  })();
  return livePromise;
}

export const ArcClient = bridge;

// Also expose globally for non-module scripts.
if (typeof globalThis !== 'undefined') {
  globalThis.ArcClient = bridge;
  globalThis.ensureArcClient = ensureArcClient;
}
