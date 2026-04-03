// ARC Dashboard — WebSocket Client

class DashboardWS {
  constructor() {
    this._handlers = new Map();
    this._ws = null;
    this._reconnectTimer = null;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this._ws = new WebSocket(`${proto}://${location.host}/ws`);

    this._ws.onopen = () => this._emit('connected', {});
    this._ws.onclose = () => {
      this._emit('disconnected', {});
      this._reconnectTimer = setTimeout(() => this.connect(), 3000);
    };
    this._ws.onerror = () => {};
    this._ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event) this._emit(msg.event, msg.data);
      } catch { /* ignore malformed */ }
    };
  }

  disconnect() {
    clearTimeout(this._reconnectTimer);
    if (this._ws) this._ws.close();
  }

  on(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(handler);
  }

  off(event, handler) {
    this._handlers.get(event)?.delete(handler);
  }

  _emit(event, data) {
    this._handlers.get(event)?.forEach(fn => fn(data));
  }
}

export const ws = new DashboardWS();
