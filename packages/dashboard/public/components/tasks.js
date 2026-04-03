// ARC Dashboard — Tasks View
import { api } from '../scripts/api.js';
import { registerView } from '../scripts/router.js';

function priorityTag(p) {
  const cls = p === 'critical' ? 'tag--error' :
              p === 'high' ? 'tag--warning' :
              p === 'medium' ? 'tag--active' : '';
  return `<span class="tag ${cls}">${p}</span>`;
}

function statusTag(s) {
  const cls = s === 'completed' ? 'tag--success' :
              s === 'working' ? 'tag--active' :
              s === 'failed' ? 'tag--error' :
              s === 'cancelled' ? 'tag--warning' : '';
  return `<span class="tag ${cls}">${s}</span>`;
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
      <td class="data" style="color: var(--text-disabled)">${(t.id || '').slice(0, 8)}</td>
      <td>${t.description || '—'}</td>
      <td>${statusTag(t.status)}</td>
      <td>${priorityTag(t.priority || 'medium')}</td>
      <td class="data">${t.assignee || '—'}</td>
      <td class="data numeric" style="color: var(--text-disabled)">${t.updated ? new Date(t.updated).toLocaleString() : '—'}</td>
    </tr>`).join('');

  const working = tasks.filter(t => t.status === 'working').length;
  const completed = tasks.filter(t => t.status === 'completed').length;

  return `
    <div class="main__header">
      <h1 class="main__title">Tasks</h1>
      <span class="main__subtitle">${working} WORKING · ${completed} COMPLETED · ${tasks.length} TOTAL</span>
    </div>
    <table class="table">
      <thead><tr>
        <th>ID</th><th>Description</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Updated</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

registerView('tasks', render);
