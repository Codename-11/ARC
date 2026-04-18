// ARC Dashboard — Pipelines View (Phase 8)
//
// Configure a staged PLAN → EXEC → VERIFY workflow, POST /api/pipeline/run,
// and track phase transitions live via `pipeline-event` WebSocket frames.
// History sidebar reads from ~/.arc/pipelines/.

import { api } from '../scripts/api.js';
import { ws } from '../scripts/ws.js';
import { registerView } from '../scripts/router.js';
import { escapeHtml } from '../scripts/utils.js';

// ---------------------------------------------------------------------------
// Auth
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
// State
// ---------------------------------------------------------------------------

const PHASES = ['plan', 'exec', 'verify'];
const DEFAULT_TIMEOUTS = { plan: 120000, exec: 300000, verify: 120000 };

const state = {
  profiles: [],
  agents: [],
  phaseEnabled: { plan: true, exec: true, verify: true },
  phaseTimeoutMs: { ...DEFAULT_TIMEOUTS },
  runningId: null,
  currentPhase: null,
  phaseLog: [],   // { phase, durationMs?, at }
  listeners: [],
  selectedHistoryId: null,
};

function resetState() {
  for (const [evt, fn] of state.listeners) ws.off(evt, fn);
  state.listeners = [];
  state.runningId = null;
  state.currentPhase = null;
  state.phaseLog = [];
  state.agents = [];
  state.selectedHistoryId = null;
}

function listen(event, handler) {
  ws.on(event, handler);
  state.listeners.push([event, handler]);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function phaseTracker() {
  return PHASES.map((phase) => {
    const enabled = state.phaseEnabled[phase];
    const status = !enabled
      ? 'disabled'
      : state.currentPhase === phase
        ? 'active'
        : state.phaseLog.some((e) => e.phase === phase && e.durationMs !== undefined)
          ? 'done'
          : 'pending';
    return `
      <div class="pipe-phase pipe-phase--${status}" data-phase="${phase}">
        <div class="pipe-phase__label">${phase.toUpperCase()}</div>
        <div class="pipe-phase__status">${status.toUpperCase()}</div>
      </div>`;
  }).join('<div class="pipe-phase__arrow">→</div>');
}

function agentRow(agent, idx) {
  const options = state.profiles
    .map(
      (p) =>
        `<option value="${escapeHtml(p.name)}" ${p.name === agent.profileName ? 'selected' : ''}>${escapeHtml(p.name)}</option>`,
    )
    .join('');
  return `
    <div class="pipe-agent" data-idx="${idx}">
      <select class="chat-control__select" data-idx="${idx}">${options}</select>
      <button class="btn btn--ghost" data-action="remove-agent" data-idx="${idx}">×</button>
    </div>`;
}

function phaseToggle(phase) {
  const checked = state.phaseEnabled[phase] ? 'checked' : '';
  return `
    <label class="pipe-toggle">
      <input type="checkbox" data-phase-toggle="${phase}" ${checked} />
      <span>${phase.toUpperCase()}</span>
      <input type="number" min="1000" step="1000" value="${state.phaseTimeoutMs[phase]}" data-phase-timeout="${phase}" class="chat-control__select pipe-timeout" />
      <span class="chat-control__label">ms</span>
    </label>`;
}

function transcriptRow(entry) {
  const dur =
    typeof entry.durationMs === 'number'
      ? `${entry.durationMs}ms`
      : entry.at
        ? new Date(entry.at).toLocaleTimeString()
        : '';
  return `
    <div class="pipe-log__row">
      <span class="pipe-log__phase">${escapeHtml(String(entry.phase).toUpperCase())}</span>
      <span class="pipe-log__dur">${escapeHtml(dur)}</span>
    </div>`;
}

function renderTracker() {
  const el = document.getElementById('pipe-tracker');
  if (el) el.innerHTML = phaseTracker();
}

function renderAgents() {
  const el = document.getElementById('pipe-agents');
  if (!el) return;
  el.innerHTML = state.agents.map((a, i) => agentRow(a, i)).join('') ||
    '<div class="rt-empty">No agents — press + ADD AGENT.</div>';
  wireAgentHandlers();
}

function renderLog() {
  const el = document.getElementById('pipe-log');
  if (!el) return;
  el.innerHTML = state.phaseLog.map(transcriptRow).join('') ||
    '<div class="rt-empty">No phase activity yet.</div>';
  el.scrollTop = el.scrollHeight;
}

function historyRow(h) {
  const cls =
    h.id === state.selectedHistoryId
      ? 'rt-history__row rt-history__row--active'
      : 'rt-history__row';
  const phases = Array.isArray(h.phases) ? h.phases.join(' → ') : '';
  return `
    <div class="${cls}" data-history-id="${escapeHtml(h.id)}">
      <div class="rt-history__topic">${escapeHtml(phases || '(pipeline)')}</div>
      <div class="rt-history__meta">
        <span>${escapeHtml(new Date(h.createdAt || 0).toLocaleString())}</span>
      </div>
    </div>`;
}

async function refreshHistory() {
  const el = document.getElementById('pipe-history');
  if (!el) return;
  try {
    const res = await fetch('/api/pipeline/history');
    if (!res.ok) return;
    const list = await res.json();
    el.innerHTML = Array.isArray(list)
      ? list.map(historyRow).join('') || '<div class="rt-empty">No past pipelines.</div>'
      : '';
    el.querySelectorAll('[data-history-id]').forEach((row) => {
      row.addEventListener('click', () => loadHistory(row.getAttribute('data-history-id')));
    });
  } catch {
    /* ignore */
  }
}

async function loadHistory(id) {
  try {
    const res = await fetch(`/api/pipeline/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const record = await res.json();
    state.selectedHistoryId = id;
    const result = record.result || {};
    state.phaseLog = (result.phasesCompleted || [])
      .map((p) => ({ phase: p, at: record.createdAt }))
      .concat(
        (result.phasesTimedOut || []).map((p) => ({ phase: `${p} (timeout)`, at: record.createdAt })),
      );
    state.currentPhase = null;
    renderTracker();
    renderLog();
    refreshHistory();
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wireAgentHandlers() {
  document.querySelectorAll('#pipe-agents select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.getAttribute('data-idx'), 10);
      if (!Number.isNaN(idx) && state.agents[idx]) {
        state.agents[idx].profileName = sel.value;
      }
    });
  });
  document.querySelectorAll('#pipe-agents [data-action="remove-agent"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      if (!Number.isNaN(idx)) {
        state.agents.splice(idx, 1);
        renderAgents();
      }
    });
  });
}

function wireUi() {
  document.getElementById('pipe-add-agent')?.addEventListener('click', () => {
    const p = state.profiles[0]?.name || '';
    state.agents.push({ profileName: p });
    renderAgents();
  });

  document.querySelectorAll('[data-phase-toggle]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const phase = cb.getAttribute('data-phase-toggle');
      state.phaseEnabled[phase] = cb.checked;
      renderTracker();
    });
  });

  document.querySelectorAll('[data-phase-timeout]').forEach((input) => {
    input.addEventListener('input', () => {
      const phase = input.getAttribute('data-phase-timeout');
      const n = parseInt(input.value, 10);
      if (!Number.isNaN(n) && n > 0) state.phaseTimeoutMs[phase] = n;
    });
  });

  document.getElementById('pipe-start')?.addEventListener('click', startRun);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function startRun() {
  if (state.agents.length === 0) {
    alert('Add at least one agent');
    return;
  }
  const phases = PHASES.filter((p) => state.phaseEnabled[p]);
  if (phases.length === 0) {
    alert('Enable at least one phase');
    return;
  }

  state.phaseLog = [];
  state.currentPhase = null;
  state.runningId = null;
  state.selectedHistoryId = null;
  renderTracker();
  renderLog();

  try {
    const res = await authFetch('/api/pipeline/run', {
      method: 'POST',
      body: JSON.stringify({
        phases,
        phaseTimeoutMs: phases.reduce((acc, p) => {
          acc[p] = state.phaseTimeoutMs[p];
          return acc;
        }, {}),
        agents: state.agents.map((a) => ({ profileName: a.profileName })),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      alert(`Failed: ${err.error || res.statusText}`);
      return;
    }
    const body = await res.json();
    state.runningId = body.pipelineId;
  } catch (err) {
    alert(`Failed: ${err.message}`);
  }
}

function onPipelineEvent(data) {
  if (!data) return;
  if (state.runningId && data.pipelineId !== state.runningId) return;
  const phase = data.phase;
  if (!phase) return;
  state.phaseLog.push({
    phase,
    durationMs: data.durationMs,
    at: Date.now(),
  });
  if (PHASES.includes(phase)) state.currentPhase = phase;
  if (phase === 'complete' || phase === 'aborted' || phase === 'persisted') {
    state.currentPhase = null;
    if (phase === 'persisted') refreshHistory();
  }
  renderTracker();
  renderLog();
}

function onPipelineError(data) {
  if (!data) return;
  if (state.runningId && data.pipelineId !== state.runningId) return;
  state.phaseLog.push({ phase: `error: ${data.error || 'unknown'}`, at: Date.now() });
  state.currentPhase = null;
  renderTracker();
  renderLog();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

async function render() {
  resetState();

  listen('pipeline-event', onPipelineEvent);
  listen('pipeline-error', onPipelineError);

  let profiles = [];
  try {
    profiles = await api.profiles();
  } catch {
    profiles = [];
  }
  state.profiles = profiles;

  if (state.agents.length === 0 && profiles.length > 0) {
    state.agents = [{ profileName: profiles[0].name }];
  }

  setTimeout(() => {
    wireUi();
    renderTracker();
    renderAgents();
    renderLog();
    refreshHistory();
  }, 0);

  const phaseToggles = PHASES.map(phaseToggle).join('');

  return `
    <div class="main__header">
      <h1 class="main__title">Pipelines</h1>
      <span class="main__subtitle">PLAN → EXEC → VERIFY</span>
    </div>
    <div class="rt-layout">
      <aside class="rt-history-sidebar">
        <div class="chat-sidebar__header">
          <span class="chat-sidebar__title">HISTORY</span>
        </div>
        <div id="pipe-history" class="rt-history"></div>
      </aside>
      <section class="rt-main">
        <div class="rt-config">
          <div class="pipe-toggles">${phaseToggles}</div>
          <div class="rt-config__row">
            <button id="pipe-add-agent" class="btn btn--ghost">+ ADD AGENT</button>
            <button id="pipe-start" class="btn">RUN PIPELINE</button>
          </div>
          <div id="pipe-agents" class="rt-agents"></div>
        </div>
        <div id="pipe-tracker" class="pipe-tracker"></div>
        <div id="pipe-log" class="pipe-log"></div>
      </section>
    </div>`;
}

registerView('pipelines', render);
