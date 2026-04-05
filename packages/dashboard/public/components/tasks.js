// ARC Dashboard — Tasks View
import { api } from '../scripts/api.js';
import { registerView, navigateTo } from '../scripts/router.js';
import { escapeHtml } from '../scripts/utils.js';

function priorityTag(p) {
  const cls = p === 'critical' ? 'tag--error' :
              p === 'high' ? 'tag--warning' :
              p === 'medium' ? 'tag--active' : '';
  return `<span class="tag ${cls}">${escapeHtml(p)}</span>`;
}

function statusTag(s) {
  const cls = s === 'completed' ? 'tag--success' :
              s === 'working' ? 'tag--active' :
              s === 'failed' ? 'tag--error' :
              s === 'cancelled' ? 'tag--warning' : '';
  return `<span class="tag ${cls}">${escapeHtml(s)}</span>`;
}

function attachActionHandlers() {
  document.querySelectorAll('.task-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await api.deleteTask(id);
        navigateTo('tasks');
      } catch (err) {
        btn.disabled = false;
      }
    });
  });
}

async function render() {
  let tasks;
  try {
    tasks = await api.tasks();
  } catch {
    tasks = [];
  }

  if (!tasks.length) {
    return `
      <div class="main__header">
        <h1 class="main__title">Tasks</h1>
        <span class="main__subtitle">TASK MANAGEMENT</span>
      </div>
      <div class="empty">
        <div class="empty__title">No tasks created</div>
        <div class="empty__desc">Agents create tasks via TaskCreate tool</div>
      </div>`;
  }

  const rows = tasks.map(t => `
    <tr>
      <td class="data" style="color: var(--text-disabled)">${escapeHtml((t.id || '').slice(0, 8))}</td>
      <td>${escapeHtml(t.description || '—')}</td>
      <td>${statusTag(t.status)}</td>
      <td>${priorityTag(t.priority || 'medium')}</td>
      <td class="data">${escapeHtml(t.assignee || '—')}</td>
      <td class="data numeric" style="color: var(--text-disabled)">${t.updated ? escapeHtml(new Date(t.updated).toLocaleString()) : '—'}</td>
      <td><button class="btn--ghost caption task-delete-btn" data-id="${escapeHtml(t.id)}">DELETE</button></td>
    </tr>`).join('');

  const working = tasks.filter(t => t.status === 'working').length;
  const completed = tasks.filter(t => t.status === 'completed').length;

  // Attach action handlers after DOM update
  setTimeout(attachActionHandlers, 0);

  return `
    <div class="main__header">
      <h1 class="main__title">Tasks</h1>
      <span class="main__subtitle">${working} WORKING · ${completed} COMPLETED · ${tasks.length} TOTAL</span>
    </div>
    <table class="table">
      <thead><tr>
        <th>ID</th><th>Description</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Updated</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

registerView('tasks', render);
