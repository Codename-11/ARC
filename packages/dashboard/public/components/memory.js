// ARC Dashboard — Memory Explorer View
import { api } from '../scripts/api.js';
import { registerView } from '../scripts/router.js';

function scopeTag(scope) {
  const cls = scope === 'session' ? '' :
              scope === 'persistent' ? 'tag--active' :
              scope === 'team' ? 'tag--warning' : '';
  return `<span class="tag ${cls}">${scope}</span>`;
}

function typeTag(type) {
  const cls = type === 'correction' ? 'tag--error' :
              type === 'preference' ? 'tag--active' : '';
  return `<span class="tag ${cls}">${type}</span>`;
}

function relevanceBar(score) {
  const pct = Math.round(score * 100);
  const color = score >= 0.7 ? 'var(--success)' :
                score >= 0.4 ? 'var(--warning)' : 'var(--text-disabled)';
  return `
    <div style="display: flex; align-items: center; gap: var(--space-sm)">
      <div style="height: 4px; width: 60px; background: var(--border)">
        <div style="height: 100%; width: ${pct}%; background: ${color}"></div>
      </div>
      <span class="caption">${pct}%</span>
    </div>`;
}

async function render() {
  let entries;
  try {
    entries = await api.memory();
  } catch {
    entries = [];
  }

  if (!entries.length) {
    return `
      <div class="main__header">
        <h1 class="main__title">Memory</h1>
        <span class="main__subtitle">HIERARCHICAL MEMORY EXPLORER</span>
      </div>
      <div class="empty dot-grid-subtle">
        <div class="empty__title">Memory is empty</div>
        <div class="empty__desc">Memories are extracted from agent conversations automatically</div>
      </div>`;
  }

  const rows = entries.map(m => `
    <tr>
      <td>${scopeTag(m.scope)}</td>
      <td>${typeTag(m.type)}</td>
      <td style="max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${m.content || '—'}</td>
      <td>${relevanceBar(m.relevanceScore ?? 0)}</td>
      <td class="data numeric">${m.accessCount ?? 0}</td>
      <td class="data numeric" style="color: var(--text-disabled)">${m.tags?.join(', ') || '—'}</td>
    </tr>`).join('');

  return `
    <div class="main__header">
      <h1 class="main__title">Memory</h1>
      <span class="main__subtitle">${entries.length} ENTRIES</span>
    </div>
    <table class="table">
      <thead><tr>
        <th>Scope</th><th>Type</th><th>Content</th><th>Relevance</th><th>Access</th><th>Tags</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

registerView('memory', render);
