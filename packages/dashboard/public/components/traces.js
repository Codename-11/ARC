// ARC Dashboard — Traces View
import { api } from '../scripts/api.js';
import { registerView } from '../scripts/router.js';

function levelTag(level) {
  const cls = level === 'error' ? 'tag--error' :
              level === 'warn' ? 'tag--warning' : '';
  return `<span class="tag ${cls}">${level}</span>`;
}

async function render() {
  let traces;
  try {
    traces = await api.traces(null, 100);
  } catch {
    traces = [];
  }

  if (!traces.length) {
    return `
      <div class="main__header">
        <h1 class="main__title">Traces</h1>
        <span class="main__subtitle">AUDIT TRAIL</span>
      </div>
      <div class="empty">
        <div class="empty__title">No traces yet</div>
        <div class="empty__desc">Hook results, risk classifications, and retry decisions appear here</div>
      </div>`;
  }

  const rows = traces.map(t => `
    <tr>
      <td class="data numeric" style="color: var(--text-disabled)">${new Date(t.timestamp).toLocaleTimeString()}</td>
      <td>${levelTag(t.level)}</td>
      <td class="data">${t.component || '—'}</td>
      <td>${t.action || '—'}</td>
      <td style="color: var(--text-secondary)">${t.detail || t.message || '—'}</td>
      <td class="data">${t.profile || '—'}</td>
    </tr>`).join('');

  return `
    <div class="main__header">
      <h1 class="main__title">Traces</h1>
      <span class="main__subtitle">${traces.length} EVENTS</span>
    </div>
    <table class="table">
      <thead><tr>
        <th>Time</th><th>Level</th><th>Component</th><th>Action</th><th>Detail</th><th>Profile</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

registerView('traces', render);
