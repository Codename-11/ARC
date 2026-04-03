// ARC Dashboard — Sessions View
import { api } from '../scripts/api.js';
import { registerView, navigateTo, setViewParam } from '../scripts/router.js';

function statusTag(status) {
  const cls = status === 'active' ? 'tag--active' :
              status === 'completed' ? 'tag--success' :
              status === 'suspended' ? 'tag--warning' : '';
  return `<span class="tag ${cls}">${status}</span>`;
}

function timeAgo(iso) {
  if (!iso) return '—';
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}

function attachRowHandlers() {
  document.querySelectorAll('tr[data-session-id]').forEach(row => {
    row.addEventListener('click', () => {
      const sessionId = row.getAttribute('data-session-id');
      if (!sessionId) return;
      setViewParam('sessionFilter', sessionId);
      navigateTo('traces');
    });
  });
}

async function render() {
  let sessions;
  try {
    sessions = await api.sessions();
  } catch {
    sessions = [];
  }

  if (!sessions.length) {
    return `
      <div class="main__header">
        <h1 class="main__title">Sessions</h1>
        <span class="main__subtitle">AGENT SESSION HISTORY</span>
      </div>
      <div class="empty">
        <div class="empty__title">No sessions recorded</div>
        <div class="empty__desc">Sessions appear when agents are launched via ARC</div>
      </div>`;
  }

  const rows = sessions.map(s => `
    <tr data-session-id="${s.id || ''}" style="cursor: pointer">
      <td>${s.name || s.id?.slice(0, 8) || '—'}</td>
      <td class="data">${s.profile || '—'}</td>
      <td>${s.adapter || '—'}</td>
      <td>${statusTag(s.status)}</td>
      <td class="data numeric">${timeAgo(s.lastActive)}</td>
    </tr>`).join('');

  // Attach click handlers after the DOM is updated
  setTimeout(attachRowHandlers, 0);

  return `
    <div class="main__header">
      <h1 class="main__title">Sessions</h1>
      <span class="main__subtitle">${sessions.length} SESSION${sessions.length !== 1 ? 'S' : ''}</span>
    </div>
    <table class="table">
      <thead><tr>
        <th>Name</th><th>Profile</th><th>Adapter</th><th>Status</th><th>Last Active</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

registerView('sessions', render);
