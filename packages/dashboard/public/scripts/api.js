// ARC Dashboard — API Client

const BASE = '';

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function postJson(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function deleteJson(path) {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function patchJson(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  // ── Read-only endpoints ──
  overview:     () => fetchJson('/api/overview'),
  health:       () => fetchJson('/api/health'),
  profiles:     () => fetchJson('/api/profiles'),
  hooks:        () => fetchJson('/api/hooks'),

  sessions:     (profile) => {
    const p = new URLSearchParams();
    if (profile) p.set('profile', profile);
    const qs = p.toString();
    return fetchJson(`/api/sessions${qs ? `?${qs}` : ''}`);
  },

  traces:       (session, limit = 50) => {
    const p = new URLSearchParams();
    if (session) p.set('session', session);
    p.set('limit', String(limit));
    return fetchJson(`/api/traces?${p}`);
  },

  risk:         () => fetchJson('/api/risk/distribution'),

  tasks:        (status, assignee) => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (assignee) p.set('assignee', assignee);
    return fetchJson(`/api/tasks?${p}`);
  },

  skills:       () => fetchJson('/api/skills'),

  memory:       (scope, type) => {
    const p = new URLSearchParams();
    if (scope) p.set('scope', scope);
    if (type) p.set('type', type);
    return fetchJson(`/api/memory?${p}`);
  },

  searchMemory: (query) => {
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    return fetchJson(`/api/memory/search?${p}`);
  },

  agents:       () => fetchJson('/api/agents'),

  factory:      (runId) => fetchJson(`/api/factory/${encodeURIComponent(runId || 'latest')}`),

  sync:         () => fetchJson('/api/sync'),
  plugins:      () => fetchJson('/api/plugins'),

  // ── Mutating endpoints ──
  deleteProfile:   (name) => deleteJson(`/api/profiles/${encodeURIComponent(name)}`),
  switchProfile:   (name) => postJson(`/api/profiles/${encodeURIComponent(name)}/switch`),

  enablePlugin:    (name) => postJson(`/api/plugins/${encodeURIComponent(name)}/enable`),
  disablePlugin:   (name) => postJson(`/api/plugins/${encodeURIComponent(name)}/disable`),

  removeAgent:     (id) => deleteJson(`/api/agents/${encodeURIComponent(id)}`),
  checkAgentHealth:(id) => fetchJson(`/api/agents/${encodeURIComponent(id)}/health`),

  deleteMemory:    (id) => deleteJson(`/api/memory/${encodeURIComponent(id)}`),

  removeSkill:     (name) => deleteJson(`/api/skills/${encodeURIComponent(name)}`),

  completeSession: (id) => postJson(`/api/sessions/${encodeURIComponent(id)}/complete`),
  suspendSession:  (id) => postJson(`/api/sessions/${encodeURIComponent(id)}/suspend`),

  updateTask:      (id, data) => patchJson(`/api/tasks/${encodeURIComponent(id)}`, data),
  deleteTask:      (id) => deleteJson(`/api/tasks/${encodeURIComponent(id)}`),

  triggerSync:     () => postJson('/api/sync/trigger'),
};
