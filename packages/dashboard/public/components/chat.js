// ARC Dashboard — Chat View (Phase 7)
//
// Streams chat completions from POST /api/chat/message via per-session
// WebSocket routing. Renders tool calls as collapsible cards, supports
// supervised-mode confirmation modals, and manages a session list sidebar.
//
// See docs/plans/ai-and-roundtable.md — Phase 7 + AD-5.

import { api } from '../scripts/api.js';
import { ws } from '../scripts/ws.js';
import { registerView } from '../scripts/router.js';
import { escapeHtml } from '../scripts/utils.js';

// ---------------------------------------------------------------------------
// Per-tab WebSocket session id
// ---------------------------------------------------------------------------
//
// One uuid per page load; persisted on `window` so the WS negotiation state
// survives view switches. The dashboard-wide `ws` connection is shared, so
// we only need to send `hello` once per tab.

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Lightweight fallback — good enough for an ephemeral session id.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getSessionId() {
  if (!window.__arcDashboardSessionId) {
    window.__arcDashboardSessionId = uuid();
  }
  return window.__arcDashboardSessionId;
}

/**
 * Send the WS `hello` message so the server can route `chat-chunk` /
 * `chat-confirm-needed` / `chat-done` events back to just this tab.
 * Idempotent and re-runs after reconnect.
 */
function ensureHello() {
  const sid = getSessionId();
  if (window.__arcDashboardHelloSent) return;
  const socket = ws._ws;
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ type: 'hello', sessionId: sid }));
    window.__arcDashboardHelloSent = true;
  }
}

/**
 * Wait (up to `timeoutMs`) until the WS is open AND the hello frame has been
 * sent. Callers that POST to an endpoint which streams back via
 * `broadcastTo(sessionId, ...)` must await this first — otherwise the
 * server's first chunks race the hello registration and get dropped.
 *
 * This is the client-side half of the hello-race fix; the server-side half
 * (`packages/dashboard/src/ws.ts`) also falls back to `broadcast` as a
 * last-resort safety net.
 */
function waitForHello(timeoutMs = 5000) {
  ensureHello();
  if (window.__arcDashboardHelloSent) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      ensureHello();
      if (window.__arcDashboardHelloSent) return resolve();
      if (Date.now() - started >= timeoutMs) return resolve(); // give up; server will fall back to broadcast
      setTimeout(check, 50);
    };
    check();
  });
}

// Re-send hello whenever the WS (re)connects.
ws.on('connected', () => {
  window.__arcDashboardHelloSent = false;
  ensureHello();
});
ws.on('disconnected', () => {
  window.__arcDashboardHelloSent = false;
});

// ---------------------------------------------------------------------------
// Bearer token lookup — mutation endpoints require Authorization.
// ---------------------------------------------------------------------------

let cachedToken = null;
async function getToken() {
  if (cachedToken) return cachedToken;
  try {
    const res = await fetch('/api/auth/token');
    if (!res.ok) return null;
    const body = await res.json();
    cachedToken = body.token || null;
    return cachedToken;
  } catch {
    return null;
  }
}

async function authFetch(path, init = {}) {
  const token = await getToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(path, { ...init, headers });
}

// ---------------------------------------------------------------------------
// Chat state (per render cycle)
// ---------------------------------------------------------------------------

const state = {
  profile: null,
  mode: 'supervised',
  chatSessionId: null,     // current loaded chat session (null = new)
  messages: [],            // rendered messages: { role, content, toolCalls }
  streaming: null,         // in-flight assistant message being appended
  listeners: [],           // registered ws handlers, cleared on re-render
};

function resetState() {
  // Detach any prior ws listeners so we don't duplicate on view switches.
  for (const [event, fn] of state.listeners) ws.off(event, fn);
  state.listeners = [];
  state.streaming = null;
  state.messages = [];
  state.chatSessionId = null;
}

function listen(event, handler) {
  ws.on(event, handler);
  state.listeners.push([event, handler]);
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function toolCallCard(tc) {
  const summary = typeof tc.input === 'object'
    ? JSON.stringify(tc.input).slice(0, 80)
    : String(tc.input ?? '').slice(0, 80);
  const hasResult = tc.result !== undefined || tc.error !== undefined;
  const status = tc.error ? 'error' : hasResult ? 'ok' : 'pending';
  const statusLabel = tc.error ? 'ERROR' : hasResult ? 'DONE' : 'RUNNING';

  const body = tc.error
    ? `<pre class="chat-tool__body">${escapeHtml(tc.error)}</pre>`
    : `<pre class="chat-tool__body">${escapeHtml(JSON.stringify({ input: tc.input, result: tc.result }, null, 2))}</pre>`;

  return `
    <div class="chat-tool" data-tool-id="${escapeHtml(tc.id)}" data-status="${status}">
      <div class="chat-tool__header">
        <button class="chat-tool__toggle" data-action="toggle-tool">
          <span class="chat-tool__caret">▸</span>
          <span class="chat-tool__name">${escapeHtml(tc.name)}</span>
          <span class="chat-tool__summary">(${escapeHtml(summary)})</span>
          <span class="chat-tool__status chat-tool__status--${status}">${statusLabel}</span>
        </button>
      </div>
      <div class="chat-tool__detail" hidden>${body}</div>
    </div>`;
}

function messageRow(msg) {
  const roleLabel = msg.role.toUpperCase();
  const tools = (msg.toolCalls || []).map(toolCallCard).join('');
  const content = msg.content
    ? `<div class="chat-msg__text">${escapeHtml(msg.content)}</div>`
    : '';
  return `
    <div class="chat-msg chat-msg--${msg.role}">
      <div class="chat-msg__role">${escapeHtml(roleLabel)}</div>
      ${content}
      ${tools}
    </div>`;
}

function sessionItem(s, activeId) {
  const cls = s.id === activeId ? 'chat-session chat-session--active' : 'chat-session';
  return `
    <div class="${cls}" data-session-id="${escapeHtml(s.id)}">
      <div class="chat-session__summary">${escapeHtml(s.summary)}</div>
      <div class="chat-session__meta">${escapeHtml(String(s.messageCount))} msgs</div>
      <button class="chat-session__delete" data-action="delete-session" data-id="${escapeHtml(s.id)}" title="Delete session" aria-label="Delete session">×</button>
    </div>`;
}

function renderMessages() {
  const list = document.getElementById('chat-messages');
  if (!list) return;
  if (state.messages.length === 0) {
    list.innerHTML = `
      <div class="empty--inline" style="margin: auto 0">
        <span class="empty-glyph" aria-hidden="true">◉</span>
        <div class="empty__title">Ready when you are</div>
        <div class="empty__desc">Ask a question about ARC — press <span class="kbd">Enter</span> to send</div>
      </div>`;
    return;
  }
  list.innerHTML = state.messages.map(messageRow).join('');
  list.scrollTop = list.scrollHeight;
}

function renderSessionList(sessions) {
  const el = document.getElementById('chat-sessions');
  if (!el) return;
  const items = sessions.map((s) => sessionItem(s, state.chatSessionId)).join('');
  const emptyBlock = `
    <div class="chat-sessions__empty empty--inline">
      <span class="empty-glyph" aria-hidden="true">◌</span>
      <div class="empty__title">No saved sessions</div>
      <div class="empty__desc">Start a new chat to see your history here</div>
    </div>`;
  el.innerHTML = items || emptyBlock;
  el.querySelectorAll('.chat-session').forEach((row) => {
    row.addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="delete-session"]')) return;
      const id = row.getAttribute('data-session-id');
      await loadSession(id);
    });
  });
  el.querySelectorAll('[data-action="delete-session"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      await deleteSession(id);
    });
  });
}

// ---------------------------------------------------------------------------
// Chat operations
// ---------------------------------------------------------------------------

async function refreshSessionList() {
  if (!state.profile) return;
  try {
    const res = await fetch(`/api/chat/sessions?profile=${encodeURIComponent(state.profile)}`);
    if (!res.ok) return;
    const list = await res.json();
    renderSessionList(Array.isArray(list) ? list : []);
  } catch {
    /* ignore */
  }
}

async function loadSession(id) {
  if (!state.profile) return;
  try {
    const res = await fetch(`/api/chat/sessions/${encodeURIComponent(id)}?profile=${encodeURIComponent(state.profile)}`);
    if (!res.ok) return;
    const body = await res.json();
    state.chatSessionId = body.id;
    state.messages = (body.messages || []).map((m) => ({
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
    }));
    renderMessages();
    await refreshSessionList();
  } catch {
    /* ignore */
  }
}

async function deleteSession(id) {
  if (!state.profile) return;
  try {
    await authFetch(`/api/chat/sessions/${encodeURIComponent(id)}?profile=${encodeURIComponent(state.profile)}`, {
      method: 'DELETE',
    });
    if (state.chatSessionId === id) {
      state.chatSessionId = null;
      state.messages = [];
      renderMessages();
    }
    await refreshSessionList();
  } catch {
    /* ignore */
  }
}

function newSession() {
  state.chatSessionId = null;
  state.messages = [];
  renderMessages();
  refreshSessionList();
}

async function sendMessage(text) {
  if (!text.trim()) return;
  if (!state.profile) {
    alert('Pick a profile first');
    return;
  }

  state.messages.push({ role: 'user', content: text });
  state.streaming = { role: 'assistant', content: '', toolCalls: [] };
  state.messages.push(state.streaming);
  renderMessages();

  // Must resolve the hello handshake *before* POSTing, otherwise the server
  // starts streaming chunks via broadcastTo(sessionId, ...) and they get
  // dropped because our session isn't registered yet.
  await waitForHello();

  try {
    const res = await authFetch('/api/chat/message', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: getSessionId(),
        profile: state.profile,
        message: text,
        mode: state.mode,
        chatSessionId: state.chatSessionId || undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      state.streaming.content = `[error] ${err.error || res.statusText}`;
      state.streaming = null;
      renderMessages();
      return;
    }
    const body = await res.json();
    if (body.chatSessionId) {
      state.chatSessionId = body.chatSessionId;
      await refreshSessionList();
    }
  } catch (err) {
    state.streaming.content = `[error] ${err.message}`;
    state.streaming = null;
    renderMessages();
  }
}

// ---------------------------------------------------------------------------
// WS event handlers
// ---------------------------------------------------------------------------

function onChunk(data) {
  if (!state.streaming || !data) return;

  if (data.type === 'text') {
    state.streaming.content += data.content || '';
    renderMessages();
  } else if (data.type === 'thinking') {
    // Ignore in the visible transcript for now — keep chat focused.
  } else if (data.type === 'tool_call') {
    state.streaming.toolCalls.push({
      id: data.id,
      name: data.tool,
      input: data.input,
    });
    renderMessages();
  } else if (data.type === 'tool_result') {
    const tc = state.streaming.toolCalls.find((t) => t.id === data.id);
    if (tc) {
      const r = data.result || {};
      if (r.ok === false) {
        tc.error = r.error || 'tool error';
      } else {
        tc.result = r.output;
      }
      renderMessages();
    }
  }
}

function onDone() {
  state.streaming = null;
  refreshSessionList();
}

function onError(data) {
  if (state.streaming) {
    state.streaming.content += `\n[error] ${data?.message || 'unknown'}`;
    renderMessages();
  }
}

function onConfirmNeeded(data) {
  if (!data || !data.tokenId) return;
  showConfirmModal(data.tokenId, data.prompt || 'Run tool?');
}

// ---------------------------------------------------------------------------
// Confirmation modal
// ---------------------------------------------------------------------------

function showConfirmModal(tokenId, prompt) {
  const existing = document.getElementById('chat-confirm-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'chat-confirm-modal';
  overlay.className = 'modal-overlay chat-confirm';
  overlay.innerHTML = `
    <div class="modal chat-confirm__box" role="dialog" aria-modal="true" aria-labelledby="chat-confirm-title">
      <div class="modal__title" id="chat-confirm-title">ALLOW TOOL?</div>
      <div class="modal__body">
        <pre class="chat-confirm__prompt">${escapeHtml(prompt)}</pre>
      </div>
      <div class="modal__actions">
        <button class="btn btn--secondary" data-confirm="deny">DENY</button>
        <button class="btn btn--primary" data-confirm="allow">APPROVE</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const respond = async (allow) => {
    overlay.remove();
    try {
      await authFetch('/api/chat/confirm', {
        method: 'POST',
        body: JSON.stringify({ sessionId: getSessionId(), tokenId, allow }),
      });
    } catch {
      /* ignore — server will auto-deny after timeout */
    }
  };

  overlay.querySelector('[data-confirm="allow"]').addEventListener('click', () => respond(true));
  overlay.querySelector('[data-confirm="deny"]').addEventListener('click', () => respond(false));
}

// ---------------------------------------------------------------------------
// Event wiring for interactive UI
// ---------------------------------------------------------------------------

function wireUi() {
  const sendBtn = document.getElementById('chat-send');
  const input = document.getElementById('chat-input');
  const profileSelect = document.getElementById('chat-profile');
  const modeSelect = document.getElementById('chat-mode');
  const newBtn = document.getElementById('chat-new');

  sendBtn?.addEventListener('click', () => {
    const text = input.value;
    input.value = '';
    sendMessage(text);
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = input.value;
      input.value = '';
      sendMessage(text);
    }
  });

  profileSelect?.addEventListener('change', () => {
    state.profile = profileSelect.value;
    refreshSessionList();
  });

  modeSelect?.addEventListener('change', () => {
    state.mode = modeSelect.value;
  });

  newBtn?.addEventListener('click', () => {
    newSession();
  });

  // Tool-call expand/collapse via event delegation.
  document.getElementById('chat-messages')?.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-action="toggle-tool"]');
    if (!toggle) return;
    const tool = toggle.closest('.chat-tool');
    if (!tool) return;
    const detail = tool.querySelector('.chat-tool__detail');
    const caret = tool.querySelector('.chat-tool__caret');
    const isHidden = detail.hasAttribute('hidden');
    if (isHidden) {
      detail.removeAttribute('hidden');
      caret.textContent = '▾';
    } else {
      detail.setAttribute('hidden', '');
      caret.textContent = '▸';
    }
  });
}

// ---------------------------------------------------------------------------
// View render
// ---------------------------------------------------------------------------

async function render() {
  resetState();
  ensureHello();

  // Listen for per-session chat events. These are filtered server-side via
  // broadcastTo() so only this tab's chunks arrive.
  listen('chat-chunk', onChunk);
  listen('chat-done', onDone);
  listen('chat-error', onError);
  listen('chat-confirm-needed', onConfirmNeeded);

  // Load profile list for the dropdown.
  let profiles = [];
  try {
    profiles = await api.profiles();
  } catch {
    profiles = [];
  }
  if (profiles.length > 0 && !state.profile) {
    const active = profiles.find((p) => p.active);
    state.profile = active ? active.name : profiles[0].name;
  }

  const profileOptions = profiles
    .map((p) => `<option value="${escapeHtml(p.name)}" ${p.name === state.profile ? 'selected' : ''}>${escapeHtml(p.name)}</option>`)
    .join('');

  // Kick off a session-list refresh after render commits.
  setTimeout(() => {
    wireUi();
    refreshSessionList();
  }, 0);

  const skeletonRows = Array.from({ length: 3 }).map(() => `
    <div class="skeleton">
      <div class="skeleton__line"></div>
      <div class="skeleton__line skeleton__line--short"></div>
    </div>`).join('');

  const modeHint = 'read-only: safe tools only. supervised: ask before write/exec. autonomous: no prompts.';

  return `
    <div class="main__header">
      <h1 class="main__title">Chat</h1>
      <span class="main__subtitle">IN-APP ASSISTANT</span>
    </div>
    <div id="chat-banner" class="is-hidden"></div>
    <div class="chat-layout">
      <aside class="chat-sidebar" aria-label="Chat sessions">
        <div class="chat-sidebar__header">
          <span class="chat-sidebar__title">SESSIONS</span>
          <button id="chat-new" class="btn btn--ghost" aria-label="New chat session">+ NEW</button>
        </div>
        <div id="chat-sessions" class="chat-sessions">${skeletonRows}</div>
      </aside>
      <section class="chat-main">
        <div class="chat-controls">
          <label class="chat-control">
            <span class="chat-control__label">PROFILE</span>
            <select id="chat-profile" class="chat-control__select" aria-label="Active profile">
              ${profileOptions || '<option value="">(none)</option>'}
            </select>
          </label>
          <label class="chat-control">
            <span class="chat-control__label">
              MODE
              <span class="help-icon" tabindex="0" data-hint="${escapeHtml(modeHint)}" aria-label="Mode help">?</span>
            </span>
            <select id="chat-mode" class="chat-control__select" aria-label="Permission mode">
              <option value="read-only" ${state.mode === 'read-only' ? 'selected' : ''}>read-only</option>
              <option value="supervised" ${state.mode === 'supervised' ? 'selected' : ''}>supervised</option>
              <option value="autonomous" ${state.mode === 'autonomous' ? 'selected' : ''}>autonomous</option>
            </select>
          </label>
        </div>
        <div id="chat-messages" class="chat-messages" role="log" aria-live="polite"></div>
        <div class="chat-input-row">
          <textarea id="chat-input" class="chat-input" rows="2" placeholder="Ask about ARC... (Enter to send, Shift+Enter for newline)" aria-label="Chat message"></textarea>
          <button id="chat-send" class="btn" aria-label="Send message">SEND</button>
        </div>
      </section>
    </div>`;
}

registerView('chat', render);
