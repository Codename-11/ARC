// ARC Dashboard — API Client

const BASE = '';

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  overview:     () => fetchJson('/api/overview'),
  health:       () => fetchJson('/api/health'),
  profiles:     () => fetchJson('/api/profiles'),
  sessions:     (profile) => fetchJson(`/api/sessions${profile ? `?profile=${profile}` : ''}`),
  traces:       (session, limit = 50) => fetchJson(`/api/traces?session=${session || ''}&limit=${limit}`),
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
  agents:       () => fetchJson('/api/agents'),
  factory:      (runId) => fetchJson(`/api/factory/${runId || 'latest'}`),
  sync:         () => fetchJson('/api/sync'),
  plugins:      () => fetchJson('/api/plugins'),
};
