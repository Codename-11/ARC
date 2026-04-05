// ARC Dashboard — Sync View
import { api } from '../scripts/api.js';
import { registerView, navigateTo } from '../scripts/router.js';
import { escapeHtml } from '../scripts/utils.js';

// TODO: Replace placeholder data with live API call once /api/sync endpoint exists

function statusDot(state) {
  const color = state === 'connected' ? 'var(--success)' :
                state === 'pending'   ? 'var(--warning)' : 'var(--text-disabled)';
  return `<div style="width: 6px; height: 6px; border-radius: 50%; background: ${color}; display: inline-block; margin-right: var(--space-xs)"></div>`;
}

function syncItemRow(label, status) {
  const color = status === 'synced'  ? 'var(--success)' :
                status === 'pending' ? 'var(--warning)' : 'var(--text-disabled)';
  return `
    <div class="stat-row">
      <span class="stat-row__label">${escapeHtml(label)}</span>
      <span class="stat-row__value" style="color: ${color}">${escapeHtml(status.toUpperCase())}</span>
    </div>`;
}

function logEntry(time, action, detail) {
  return `
    <div class="stat-row">
      <span class="stat-row__label" style="color: var(--text-disabled)">${escapeHtml(time)}</span>
      <span class="stat-row__value">${escapeHtml(action)} — ${escapeHtml(detail)}</span>
    </div>`;
}

function attachActionHandlers() {
  const syncBtn = document.getElementById('sync-trigger-btn');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      try {
        await api.triggerSync();
        navigateTo('sync');
      } catch (err) {
        syncBtn.disabled = false;
      }
    });
  }
}

async function render() {
  let data;
  try {
    data = await api.sync();
  } catch {
    data = null;
  }

  // TODO: Use live data when available; for now show placeholder
  const provider = data?.provider ?? 'Shared Layer';
  const lastSync = data?.lastSync ?? '—';
  const state = data?.state ?? 'inactive';

  const items = data?.items ?? [
    { label: 'MCPs',      status: 'synced' },
    { label: 'Commands',  status: 'synced' },
    { label: 'CLAUDE.MD', status: 'pending' },
    { label: 'Memory',    status: 'synced' },
    { label: 'Projects',  status: 'pending' },
  ];

  const logs = data?.log ?? [
    { time: '12:04:31', action: 'PULLED',   detail: '3 MCP servers from shared layer' },
    { time: '12:03:58', action: 'PUSHED',   detail: 'CLAUDE.md to shared layer' },
    { time: '11:59:12', action: 'CONFLICT', detail: 'projects/web-app — local kept' },
    { time: '11:45:00', action: 'PULLED',   detail: '2 commands from shared layer' },
  ];

  const syncedCount = items.filter(i => i.status === 'synced').length;
  const pendingCount = items.filter(i => i.status === 'pending').length;

  // Attach action handlers after DOM update
  setTimeout(attachActionHandlers, 0);

  return `
    <div class="main__header">
      <h1 class="main__title">Sync</h1>
      <span class="main__subtitle">${syncedCount} SYNCED · ${pendingCount} PENDING</span>
      <button id="sync-trigger-btn" class="btn--ghost caption" style="margin-left: var(--space-md)">SYNC NOW</button>
    </div>

    <div class="grid-3">
      <div class="card">
        <div class="card__label">SYNC STATUS</div>
        <div class="stat-row">
          <span class="stat-row__label">PROVIDER</span>
          <span class="stat-row__value">${escapeHtml(provider)}</span>
        </div>
        <div class="stat-row">
          <span class="stat-row__label">LAST SYNC</span>
          <span class="stat-row__value" style="color: var(--text-secondary)">${escapeHtml(lastSync)}</span>
        </div>
        <div class="stat-row">
          <span class="stat-row__label">STATE</span>
          <span class="stat-row__value">
            ${statusDot(state)}
            ${escapeHtml(state.toUpperCase())}
          </span>
        </div>
      </div>

      <div class="card">
        <div class="card__label">SYNCED ITEMS</div>
        ${items.map(i => syncItemRow(i.label, i.status)).join('')}
      </div>

      <div class="card">
        <div class="card__label">SYNC LOG</div>
        ${logs.map(l => logEntry(l.time, l.action, l.detail)).join('')}
      </div>
    </div>`;
}

registerView('sync', render);
