// ARC Dashboard — Diagnostics View
import { api } from '../scripts/api.js';
import { registerView } from '../scripts/router.js';
import { escapeHtml } from '../scripts/utils.js';

function statusIcon(status) {
  if (status === 'pass' || status === 'ok') {
    return `<span style="color: var(--success)">PASS</span>`;
  }
  if (status === 'warn') {
    return `<span style="color: var(--warning)">WARN</span>`;
  }
  if (status === 'fail' || status === 'error') {
    return `<span style="color: var(--error)">FAIL</span>`;
  }
  return `<span style="color: var(--text-disabled)">—</span>`;
}

function statusDot(status) {
  const color = status === 'ok' ? 'var(--success)'
    : status === 'warn' ? 'var(--warning)'
    : status === 'fail' || status === 'error' ? 'var(--error)'
    : 'var(--text-disabled)';
  return `<div style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; display: inline-block"></div>`;
}

function checkRow(check) {
  return `
    <div class="stat-row">
      <span class="stat-row__label" style="display: inline-flex; align-items: center; gap: var(--space-sm)">
        ${statusIcon(check.status)}
        <span>${escapeHtml(check.label || check.id || 'Check')}</span>
      </span>
      <span class="stat-row__value" style="font-size: var(--caption); color: var(--text-secondary)">${escapeHtml(check.detail || check.summary || '—')}</span>
    </div>`;
}

async function render() {
  let health;
  try {
    health = await api.health();
  } catch {
    health = { status: 'unknown', timestamp: null, uptime: 0 };
  }

  const overallStatus = health.status || 'unknown';
  const uptimeSeconds = Math.floor(health.uptime || 0);
  const uptimeMinutes = Math.floor(uptimeSeconds / 60);
  const uptimeHours = Math.floor(uptimeMinutes / 60);
  const uptimeDisplay = uptimeHours > 0
    ? `${uptimeHours}h ${uptimeMinutes % 60}m`
    : uptimeMinutes > 0
      ? `${uptimeMinutes}m ${uptimeSeconds % 60}s`
      : `${uptimeSeconds}s`;

  const nodeVersion = typeof process !== 'undefined' ? (process.version || '—') : '—';
  const platformInfo = typeof navigator !== 'undefined' ? navigator.platform : '—';

  // System-level diagnostics derived from the health endpoint
  const systemChecks = [
    {
      id: 'server-status',
      label: 'Dashboard Server',
      status: overallStatus === 'ok' ? 'pass' : overallStatus,
      detail: `Status: ${overallStatus.toUpperCase()}`,
    },
    {
      id: 'uptime',
      label: 'Server Uptime',
      status: uptimeSeconds > 0 ? 'pass' : 'warn',
      detail: uptimeDisplay,
    },
    {
      id: 'api-connectivity',
      label: 'API Connectivity',
      status: health.timestamp ? 'pass' : 'fail',
      detail: health.timestamp ? `Last response: ${new Date(health.timestamp).toLocaleTimeString()}` : 'No response',
    },
  ];

  return `
    <div class="main__header">
      <h1 class="main__title">Diagnostics</h1>
      <span class="main__subtitle">SYSTEM HEALTH</span>
    </div>

    <div class="grid-3" style="margin-bottom: var(--space-xl)">
      <div class="card">
        <div class="card__label">STATUS</div>
        <div class="card__value" style="display: flex; align-items: center; gap: var(--space-sm)">
          ${statusDot(overallStatus)}
          <span>${escapeHtml(overallStatus.toUpperCase())}</span>
        </div>
      </div>
      <div class="card">
        <div class="card__label">UPTIME</div>
        <div class="card__value card__value--sm">${escapeHtml(uptimeDisplay)}</div>
      </div>
      <div class="card">
        <div class="card__label">PLATFORM</div>
        <div class="card__value card__value--sm">${escapeHtml(platformInfo)}</div>
      </div>
    </div>

    <div class="card" style="margin-bottom: var(--space-xl)">
      <div class="card__label">HEALTH CHECKS</div>
      <div style="margin-top: var(--space-sm)">
        ${systemChecks.map(checkRow).join('')}
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card__label">SERVER INFO</div>
        <div class="stat-row">
          <span class="stat-row__label">TIMESTAMP</span>
          <span class="stat-row__value" style="font-size: var(--caption)">${health.timestamp ? escapeHtml(new Date(health.timestamp).toLocaleString()) : '—'}</span>
        </div>
        <div class="stat-row">
          <span class="stat-row__label">ENDPOINT</span>
          <span class="stat-row__value" style="font-size: var(--caption); color: var(--text-secondary)">${escapeHtml(window.location.origin)}/api/health</span>
        </div>
      </div>
      <div class="card">
        <div class="card__label">CLIENT INFO</div>
        <div class="stat-row">
          <span class="stat-row__label">BROWSER</span>
          <span class="stat-row__value" style="font-size: var(--caption); color: var(--text-secondary)">${escapeHtml(typeof navigator !== 'undefined' ? navigator.userAgent.split(' ').slice(-1)[0] : '—')}</span>
        </div>
        <div class="stat-row">
          <span class="stat-row__label">PLATFORM</span>
          <span class="stat-row__value" style="font-size: var(--caption); color: var(--text-secondary)">${escapeHtml(platformInfo)}</span>
        </div>
      </div>
    </div>`;
}

registerView('diagnostics', render);
