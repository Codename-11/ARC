// ARC Dashboard — Sessions View
import { api } from '../scripts/api.js';
import { registerView, navigateTo, setViewParam } from '../scripts/router.js';
import { escapeHtml } from '../scripts/utils.js';

function statusTag(status) {
  const cls = status === 'active' ? 'tag--active' :
              status === 'completed' ? 'tag--success' :
              status === 'suspended' ? 'tag--warning' : '';
  return `<span class="tag ${cls}">${escapeHtml(status)}</span>`;
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
    row.addEventListener('click', (e) => {
      // Don't navigate when clicking action buttons
      if (e.target.closest('button')) return;
      const sessionId = row.getAttribute('data-session-id');
      if (!sessionId) return;
      setViewParam('sessionFilter', sessionId);
      navigateTo('traces');
    });
  });

  // Action buttons
  document.querySelectorAll('.session-suspend-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await api.suspendSession(id);
        navigateTo('sessions');
      } catch (err) {
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll('.session-complete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await api.completeSession(id);
        navigateTo('sessions');
      } catch (err) {
        btn.disabled = false;
      }
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

  const rows = sessions.map(s => {
    const actions = s.status === 'active'
      ? `<button class="btn--ghost caption session-suspend-btn" data-id="${escapeHtml(s.id)}">SUSPEND</button>
         <button class="btn--ghost caption session-complete-btn" data-id="${escapeHtml(s.id)}">COMPLETE</button>`
      : '';
    return `
    <tr data-session-id="${escapeHtml(s.id || '')}" style="cursor: pointer">
      <td>${escapeHtml(s.name || s.id?.slice(0, 8) || '—')}</td>
      <td class="data">${escapeHtml(s.profile || '—')}</td>
      <td>${escapeHtml(s.adapter || '—')}</td>
      <td>${statusTag(s.status)}</td>
      <td class="data numeric">${escapeHtml(timeAgo(s.lastActive))}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');

  // Attach click handlers after the DOM is updated
  setTimeout(attachRowHandlers, 0);

  return `
    <div class="main__header">
      <h1 class="main__title">Sessions</h1>
      <span class="main__subtitle">${sessions.length} SESSION${sessions.length !== 1 ? 'S' : ''}</span>
    </div>
    <table class="table">
      <thead><tr>
        <th>Name</th><th>Profile</th><th>Adapter</th><th>Status</th><th>Last Active</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

registerView('sessions', render);
