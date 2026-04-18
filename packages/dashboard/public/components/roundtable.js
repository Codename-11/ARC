// ARC Dashboard — Roundtable View (Phase 8)
//
// Configure a multi-agent roundtable, POST /api/roundtable/run, then stream
// `roundtable-event` frames over the shared WebSocket to paint per-turn
// blocks + a synthesis card at the end. The history sidebar reflects
// persisted runs from ~/.arc/roundtables/.

import { api } from '../scripts/api.js';
import { ws } from '../scripts/ws.js';
import { registerView } from '../scripts/router.js';
import { escapeHtml } from '../scripts/utils.js';

// ---------------------------------------------------------------------------
// Bearer token lookup (mirrors chat.js — endpoint is mutation-guarded).
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
// View state
// ---------------------------------------------------------------------------

const ROLES = ['advocate', 'critic', 'neutral'];

const state = {
  profiles: [],
  agents: [],          // editable { profileName, role } entries
  rounds: 2,
  topic: '',
  synthesizer: '',     // profileName string or ''
  runningId: null,
  events: [],          // { type, ... }
  synthesis: null,     // { consensusScore, summary }
  selectedHistoryId: null,
  listeners: [],
};

function resetState() {
  for (const [evt, fn] of state.listeners) ws.off(evt, fn);
  state.listeners = [];
  state.agents = [];
  state.events = [];
  state.synthesis = null;
  state.runningId = null;
  state.selectedHistoryId = null;
}

function listen(event, handler) {
  ws.on(event, handler);
  state.listeners.push([event, handler]);
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function agentRow(agent, idx) {
  const profileOptions = state.profiles
    .map(
      (p) =>
        `<option value="${escapeHtml(p.name)}" ${p.name === agent.profileName ? 'selected' : ''}>${escapeHtml(p.name)}</option>`,
    )
    .join('');
  const roleOptions = ROLES.map(
    (r) =>
      `<option value="${r}" ${r === agent.role ? 'selected' : ''}>${r}</option>`,
  ).join('');
  return `
    <div class="rt-agent" data-idx="${idx}">
      <select class="rt-agent__profile chat-control__select" data-field="profileName" data-idx="${idx}">
        ${profileOptions}
      </select>
      <select class="rt-agent__role chat-control__select" data-field="role" data-idx="${idx}">
        ${roleOptions}
      </select>
      <button class="btn btn--ghost rt-agent__remove" data-action="remove-agent" data-idx="${idx}">×</button>
    </div>`;
}

function turnBlock(evt) {
  const role = evt.role || '';
  return `
    <div class="rt-turn rt-turn--${escapeHtml(role)}">
      <div class="rt-turn__header">
        <span class="rt-turn__agent">${escapeHtml(evt.agent || '')}</span>
        <span class="rt-turn__role">${escapeHtml(role.toUpperCase())}</span>
        <span class="rt-turn__round">ROUND ${escapeHtml(String(evt.round ?? '?'))}</span>
        <span class="rt-turn__latency">${escapeHtml(String(Math.round((evt.latencyMs ?? 0))))}ms</span>
      </div>
      <div class="rt-turn__content">${escapeHtml(evt.content || '')}</div>
    </div>`;
}

function synthesisBlock(s) {
  const pct = Math.round((s.consensusScore ?? 0) * 100);
  return `
    <div class="rt-synthesis">
      <div class="rt-synthesis__header">
        <span class="rt-synthesis__label">SYNTHESIS</span>
        <span class="rt-synthesis__score">CONSENSUS ${pct}%</span>
      </div>
      <div class="rt-synthesis__bar">
        <div class="rt-synthesis__bar-fill" style="width: ${pct}%;"></div>
      </div>
      <div class="rt-synthesis__summary">${escapeHtml(s.summary || '')}</div>
    </div>`;
}

function renderTranscript() {
  const el = document.getElementById('rt-transcript');
  if (!el) return;
  const parts = [];
  for (const evt of state.events) {
    if (evt.type === 'turn-complete') parts.push(turnBlock(evt));
  }
  if (state.synthesis) parts.push(synthesisBlock(state.synthesis));
  el.innerHTML = parts.join('') ||
    '<div class="rt-empty">No activity yet — configure agents above and press START.</div>';
  el.scrollTop = el.scrollHeight;
}

function renderAgents() {
  const el = document.getElementById('rt-agents');
  if (!el) return;
  el.innerHTML = state.agents.map((a, i) => agentRow(a, i)).join('') ||
    '<div class="rt-empty">No agents yet — press + ADD AGENT.</div>';
  wireAgentHandlers();
}

function renderSynthesizer() {
  const el = document.getElementById('rt-synthesizer');
  if (!el) return;
  const options = ['<option value="">(first agent)</option>']
    .concat(
      state.agents.map(
        (a) =>
          `<option value="${escapeHtml(a.profileName)}" ${state.synthesizer === a.profileName ? 'selected' : ''}>${escapeHtml(a.profileName)}</option>`,
      ),
    )
    .join('');
  el.innerHTML = options;
}

function historyRow(h) {
  const pct =
    typeof h.consensusScore === 'number'
      ? `${Math.round(h.consensusScore * 100)}%`
      : '—';
  const cls =
    h.id === state.selectedHistoryId
      ? 'rt-history__row rt-history__row--active'
      : 'rt-history__row';
  return `
    <div class="${cls}" data-history-id="${escapeHtml(h.id)}">
      <div class="rt-history__topic">${escapeHtml(h.topic || '(no topic)')}</div>
      <div class="rt-history__meta">
        <span>${escapeHtml(new Date(h.createdAt || 0).toLocaleString())}</span>
        <span>${pct}</span>
      </div>
    </div>`;
}

async function refreshHistory() {
  const el = document.getElementById('rt-history');
  if (!el) return;
  try {
    const res = await fetch('/api/roundtable/history');
    if (!res.ok) return;
    const list = await res.json();
    const rows = Array.isArray(list) ? list.map(historyRow).join('') : '';
    el.innerHTML = rows || '<div class="rt-empty">No past roundtables.</div>';
    el.querySelectorAll('[data-history-id]').forEach((row) => {
      row.addEventListener('click', async () => {
        const id = row.getAttribute('data-history-id');
        await loadHistory(id);
      });
    });
  } catch {
    /* ignore */
  }
}

async function loadHistory(id) {
  try {
    const res = await fetch(`/api/roundtable/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const record = await res.json();
    const result = record.result || {};
    state.selectedHistoryId = id;
    state.events = (result.transcript || []).map((m) => ({
      type: 'turn-complete',
      agent: m.agent,
      role: m.role,
      round: m.round,
      content: m.content,
      latencyMs: m.latencyMs,
    }));
    state.synthesis = {
      consensusScore: result.consensusScore ?? 0,
      summary: result.synthesis || '',
    };
    renderTranscript();
    refreshHistory();
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function wireAgentHandlers() {
  document.querySelectorAll('#rt-agents select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.getAttribute('data-idx'), 10);
      const field = sel.getAttribute('data-field');
      if (Number.isNaN(idx) || !state.agents[idx]) return;
      state.agents[idx][field] = sel.value;
      if (field === 'profileName') renderSynthesizer();
    });
  });
  document.querySelectorAll('[data-action="remove-agent"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      if (Number.isNaN(idx)) return;
      state.agents.splice(idx, 1);
      renderAgents();
      renderSynthesizer();
    });
  });
}

function wireUi() {
  document.getElementById('rt-add-agent')?.addEventListener('click', () => {
    const available = state.profiles[0]?.name || '';
    state.agents.push({
      profileName: available,
      role: ROLES[state.agents.length % ROLES.length],
    });
    renderAgents();
    renderSynthesizer();
  });

  document.getElementById('rt-topic')?.addEventListener('input', (e) => {
    state.topic = e.target.value;
  });

  document.getElementById('rt-rounds')?.addEventListener('input', (e) => {
    const n = parseInt(e.target.value, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 10) state.rounds = n;
  });

  document.getElementById('rt-synthesizer')?.addEventListener('change', (e) => {
    state.synthesizer = e.target.value;
  });

  document.getElementById('rt-start')?.addEventListener('click', startRun);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function startRun() {
  if (!state.topic.trim()) {
    alert('Enter a topic first');
    return;
  }
  if (state.agents.length < 2) {
    alert('Roundtable needs at least 2 agents');
    return;
  }
  state.events = [];
  state.synthesis = null;
  state.runningId = null;
  state.selectedHistoryId = null;
  renderTranscript();

  try {
    const res = await authFetch('/api/roundtable/run', {
      method: 'POST',
      body: JSON.stringify({
        topic: state.topic,
        agents: state.agents.map((a) => ({
          profileName: a.profileName,
          role: a.role,
        })),
        rounds: state.rounds,
        synthesizer: state.synthesizer || undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      alert(`Failed to start: ${err.error || res.statusText}`);
      return;
    }
    const body = await res.json();
    state.runningId = body.roundtableId;
  } catch (err) {
    alert(`Failed to start: ${err.message}`);
  }
}

function onRoundtableEvent(data) {
  if (!data) return;
  if (state.runningId && data.roundtableId !== state.runningId) return;
  const evt = data.event;
  if (!evt || !evt.type) return;

  if (evt.type === 'turn-complete') {
    state.events.push(evt);
    renderTranscript();
  } else if (evt.type === 'synthesis-complete') {
    state.synthesis = {
      consensusScore: evt.consensusScore ?? 0,
      summary: evt.summary || '',
    };
    renderTranscript();
    refreshHistory();
  } else if (evt.type === 'persisted') {
    refreshHistory();
  }
}

function onRoundtableError(data) {
  if (!data) return;
  if (state.runningId && data.roundtableId !== state.runningId) return;
  state.events.push({
    type: 'turn-complete',
    agent: '(error)',
    role: 'neutral',
    round: '?',
    content: `[error] ${data.error || 'unknown'}`,
    latencyMs: 0,
  });
  renderTranscript();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

async function render() {
  resetState();

  listen('roundtable-event', onRoundtableEvent);
  listen('roundtable-error', onRoundtableError);

  let profiles = [];
  try {
    profiles = await api.profiles();
  } catch {
    profiles = [];
  }
  state.profiles = profiles;

  // Seed two default agents so the form is usable immediately.
  if (state.agents.length === 0 && profiles.length >= 2) {
    state.agents = [
      { profileName: profiles[0].name, role: 'advocate' },
      { profileName: profiles[1].name, role: 'critic' },
    ];
  } else if (state.agents.length === 0 && profiles.length === 1) {
    state.agents = [{ profileName: profiles[0].name, role: 'advocate' }];
  }

  setTimeout(() => {
    wireUi();
    renderAgents();
    renderSynthesizer();
    renderTranscript();
    refreshHistory();
  }, 0);

  return `
    <div class="main__header">
      <h1 class="main__title">Roundtable</h1>
      <span class="main__subtitle">MULTI-AGENT DELIBERATION</span>
    </div>
    <div class="rt-layout">
      <aside class="rt-history-sidebar">
        <div class="chat-sidebar__header">
          <span class="chat-sidebar__title">HISTORY</span>
        </div>
        <div id="rt-history" class="rt-history"></div>
      </aside>
      <section class="rt-main">
        <div class="rt-config">
          <label class="chat-control">
            <span class="chat-control__label">TOPIC</span>
            <input id="rt-topic" class="chat-input rt-topic" placeholder="What should we discuss?" />
          </label>
          <div class="rt-config__row">
            <label class="chat-control">
              <span class="chat-control__label">ROUNDS</span>
              <input id="rt-rounds" type="number" min="1" max="10" value="${state.rounds}" class="chat-control__select rt-rounds" />
            </label>
            <label class="chat-control">
              <span class="chat-control__label">SYNTHESIZER</span>
              <select id="rt-synthesizer" class="chat-control__select"></select>
            </label>
            <button id="rt-add-agent" class="btn btn--ghost">+ ADD AGENT</button>
            <button id="rt-start" class="btn">START ROUNDTABLE</button>
          </div>
          <div id="rt-agents" class="rt-agents"></div>
        </div>
        <div id="rt-transcript" class="rt-transcript"></div>
      </section>
    </div>`;
}

registerView('roundtable', render);
