// ARC Dashboard — WebSocket Client

class DashboardWS {
  constructor() {
    this._handlers = new Map();
    this._ws = null;
    this._reconnectTimer = null;
    this._failedAttempts = 0;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    this._ws = new WebSocket(url);

    this._ws.onopen = () => {
      this._failedAttempts = 0;
      this._hideConnectionBanner();
      this._emit('connected', {});
    };
    this._ws.onclose = () => {
      this._failedAttempts++;
      this._emit('disconnected', { attempts: this._failedAttempts });
      if (this._failedAttempts >= 3) this._showConnectionBanner(url);
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

  _showConnectionBanner(url) {
    let b = document.getElementById('arc-ws-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'arc-ws-banner';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:10px 16px;background:#400;color:#fcc;font-family:monospace;font-size:12px;border-bottom:1px solid #800;text-align:center';
      document.body.appendChild(b);
    }
    b.textContent = `Disconnected from ${url} — is "pnpm dev:dashboard" still running? Retrying every 3s (attempt ${this._failedAttempts})…`;
  }
  _hideConnectionBanner() {
    const b = document.getElementById('arc-ws-banner');
    if (b) b.remove();
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
