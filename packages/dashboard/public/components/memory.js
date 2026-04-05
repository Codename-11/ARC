// ARC Dashboard — Memory Explorer View
import { api } from '../scripts/api.js';
import { registerView, navigateTo } from '../scripts/router.js';
import { escapeHtml } from '../scripts/utils.js';

function scopeTag(scope) {
  const cls = scope === 'session' ? '' :
              scope === 'persistent' ? 'tag--active' :
              scope === 'team' ? 'tag--warning' : '';
  return `<span class="tag ${cls}">${escapeHtml(scope)}</span>`;
}

function typeTag(type) {
  const cls = type === 'correction' ? 'tag--error' :
              type === 'preference' ? 'tag--active' : '';
  return `<span class="tag ${cls}">${escapeHtml(type)}</span>`;
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

function renderMemoryRow(m) {
  return `
    <tr>
      <td>${scopeTag(m.scope)}</td>
      <td>${typeTag(m.type)}</td>
      <td style="max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${escapeHtml(m.content || '—')}</td>
      <td>${relevanceBar(m.relevanceScore ?? 0)}</td>
      <td class="data numeric">${m.accessCount ?? 0}</td>
      <td class="data numeric" style="color: var(--text-disabled)">${escapeHtml(m.tags?.join(', ') || '—')}</td>
      <td><button class="btn--ghost caption memory-delete-btn" data-id="${escapeHtml(m.id)}">DELETE</button></td>
    </tr>`;
}

function attachActionHandlers() {
  // Search handler
  const searchInput = document.getElementById('memory-search');
  const searchBtn = document.getElementById('memory-search-btn');
  const msg = document.getElementById('memory-search-msg');

  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', async () => {
      const query = searchInput.value.trim();
      if (!query) return;
      searchBtn.disabled = true;
      try {
        const results = await api.searchMemory(query);
        const tbody = document.querySelector('.data-table tbody');
        if (tbody && results.length > 0) {
          tbody.innerHTML = results.map(m => renderMemoryRow(m)).join('');
          // Re-bind delete handlers for new rows
          bindDeleteHandlers();
        }
        if (msg) msg.innerHTML = `<div class="inline-msg inline-msg--success">Found ${results.length} result(s)</div>`;
      } catch (err) {
        if (msg) msg.innerHTML = `<div class="inline-msg inline-msg--error">${escapeHtml(err.message)}</div>`;
      } finally {
        searchBtn.disabled = false;
      }
    });
  }

  bindDeleteHandlers();
}

function bindDeleteHandlers() {
  document.querySelectorAll('.memory-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await api.deleteMemory(id);
        navigateTo('memory');
      } catch (err) {
        btn.disabled = false;
      }
    });
  });
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

  const rows = entries.map(m => renderMemoryRow(m)).join('');

  // Attach handlers after DOM update
  setTimeout(attachActionHandlers, 0);

  return `
    <div class="main__header">
      <h1 class="main__title">Memory</h1>
      <span class="main__subtitle">${entries.length} ENTRIES</span>
    </div>
    <div style="display: flex; gap: var(--space-sm); margin-bottom: var(--space-md); align-items: center">
      <input id="memory-search" type="text" placeholder="Search memory..." style="padding: var(--space-xs) var(--space-sm); background: var(--surface-raised); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-data); font-size: var(--caption)">
      <button id="memory-search-btn" class="btn--ghost caption">SEARCH</button>
      <span id="memory-search-msg"></span>
    </div>
    <table class="table data-table">
      <thead><tr>
        <th>Scope</th><th>Type</th><th>Content</th><th>Relevance</th><th>Access</th><th>Tags</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

registerView('memory', render);
