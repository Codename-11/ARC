// ARC Dashboard — Traces View
import { api } from '../scripts/api.js';
import { registerView, navigateTo, getViewParam, clearViewParam } from '../scripts/router.js';

/** Module-level session filter — set when navigating from sessions view. */
let sessionFilter = null;

function levelTag(level) {
  const cls = level === 'error' ? 'tag--error' :
              level === 'warn' ? 'tag--warning' : '';
  return `<span class="tag ${cls}">${level}</span>`;
}

function attachFilterHandlers() {
  const clearBtn = document.getElementById('traces-clear-filter');
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      sessionFilter = null;
      clearViewParam('sessionFilter');
      navigateTo('traces');
    });
  }
}

async function render() {
  // Pick up any session filter passed via router params
  const paramFilter = getViewParam('sessionFilter');
  if (paramFilter) {
    sessionFilter = paramFilter;
    clearViewParam('sessionFilter');
  }

  let traces;
  try {
    traces = await api.traces(sessionFilter, 100);
  } catch {
    traces = [];
  }

  const filterBanner = sessionFilter
    ? `<div style="margin-bottom: 12px; color: var(--text-secondary)">
         Filtered by session <span class="data" style="color: var(--text-primary)">${sessionFilter.slice(0, 8)}</span>
         &nbsp;<a id="traces-clear-filter" href="#" style="color: var(--accent); text-decoration: underline; cursor: pointer">clear filter</a>
       </div>`
    : '';

  // Attach handlers after DOM update
  if (sessionFilter) setTimeout(attachFilterHandlers, 0);

  if (!traces.length) {
    return `
      <div class="main__header">
        <h1 class="main__title">Traces</h1>
        <span class="main__subtitle">AUDIT TRAIL</span>
      </div>
      ${filterBanner}
      <div class="empty">
        <div class="empty__title">No traces${sessionFilter ? ' for this session' : ' yet'}</div>
        <div class="empty__desc">${sessionFilter ? 'No trace events matched this session' : 'Hook results, risk classifications, and retry decisions appear here'}</div>
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
    ${filterBanner}
    <table class="table">
      <thead><tr>
        <th>Time</th><th>Level</th><th>Component</th><th>Action</th><th>Detail</th><th>Profile</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

registerView('traces', render);
