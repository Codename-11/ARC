// ARC Dashboard — Live Hook Pipeline Monitor
import { api } from '../scripts/api.js';
import { registerView } from '../scripts/router.js';

const HOOK_NAMES = [
  'source-classify',
  'interagent-routing',
  'risk-detection',
  'attempt-tracker',
  'roundtable',
  'audit-score',
  'supervision-gate',
  'post-verify',
];

function decisionTag(decision) {
  if (!decision) return '<span class="tag">—</span>';
  const cls = decision === 'allow' || decision === 'pass' ? 'tag--success' :
              decision === 'block' || decision === 'fail' ? 'tag--error' :
              decision === 'flag' || decision === 'warn' ? 'tag--warning' : '';
  return `<span class="tag ${cls}">${decision.toUpperCase()}</span>`;
}

function modeTag(mode) {
  const cls = mode === 'enforce' ? 'tag--error' :
              mode === 'advise' ? 'tag--warning' :
              mode === 'log' ? 'tag--active' : '';
  return `<span class="tag ${cls}">${(mode || 'off').toUpperCase()}</span>`;
}

function hookRow(hook, index) {
  const statusColor = hook.status === 'pass' || hook.status === 'allow' ? 'var(--success)' :
                      hook.status === 'block' || hook.status === 'fail' ? 'var(--accent)' :
                      hook.status === 'flag' || hook.status === 'warn' ? 'var(--warning)' :
                      hook.status === 'active' ? 'var(--text-display)' : 'var(--text-disabled)';
  const dotHtml = `<div style="width: 8px; height: 8px; border-radius: 50%; background: ${statusColor}; display: inline-block"></div>`;

  return `
    <div class="stat-row">
      <span class="stat-row__label" style="display: inline-flex; align-items: center; gap: var(--space-sm)">
        ${dotHtml}
        <span class="data" style="min-width: 20px; text-align: right; color: var(--text-disabled)">${index + 1}</span>
        <span>${hook.name || HOOK_NAMES[index] || 'Unknown'}</span>
      </span>
      <span class="stat-row__value">
        ${decisionTag(hook.status || hook.lastDecision)}
      </span>
    </div>`;
}

function decisionRow(decision) {
  const time = decision.timestamp
    ? new Date(decision.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';
  return `
    <tr>
      <td class="data numeric" style="color: var(--text-disabled)">${time}</td>
      <td class="data">${decision.hook || '—'}</td>
      <td>${decisionTag(decision.decision || decision.result)}</td>
      <td style="color: var(--text-secondary); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${decision.reason || decision.detail || '—'}</td>
      <td class="data">${decision.session?.slice(0, 8) || '—'}</td>
    </tr>`;
}

function riskDistributionInline(distribution) {
  if (!distribution) return '';
  const tiers = ['read-only', 'file-modification', 'build-affecting', 'deploy-affecting', 'destructive'];
  const entries = tiers.filter(t => distribution[t] > 0);
  if (!entries.length) return '<div class="card__meta">No risk events classified</div>';

  const max = Math.max(...entries.map(t => distribution[t]), 1);
  return entries.map(tier => {
    const count = distribution[tier];
    const pct = (count / max) * 100;
    const color = tier === 'destructive' ? 'var(--accent)' :
                  tier === 'deploy-affecting' ? 'var(--warning)' :
                  tier === 'build-affecting' ? 'var(--warning)' :
                  tier === 'file-modification' ? 'var(--text-primary)' :
                  'var(--text-disabled)';
    return `
      <div style="margin-bottom: var(--space-xs)">
        <div style="display: flex; justify-content: space-between; margin-bottom: 2px">
          <span class="caption">${tier}</span>
          <span class="caption data">${count}</span>
        </div>
        <div style="height: 4px; background: var(--border); width: 100%">
          <div style="height: 100%; width: ${pct}%; background: ${color}"></div>
        </div>
      </div>`;
  }).join('');
}

async function render() {
  let data;
  try {
    data = await api.hooks();
  } catch {
    data = null;
  }

  const hooks = data?.hooks || HOOK_NAMES.map(name => ({ name, status: 'pending' }));
  const mode = data?.enforcementMode || data?.mode || 'off';
  const recentDecisions = data?.recentDecisions || [];
  const riskDist = data?.riskDistribution || null;

  const hookCount = hooks.length;
  const activeCount = hooks.filter(h => h.status && h.status !== 'pending').length;

  // Pipeline progress bar
  const pipelineSegments = hooks.map(h => {
    const cls = h.status === 'pass' || h.status === 'allow' ? 'progress-bar__segment--success' :
                h.status === 'block' || h.status === 'fail' ? 'progress-bar__segment--error' :
                h.status === 'flag' || h.status === 'warn' ? 'progress-bar__segment--warning' :
                h.status === 'active' ? 'progress-bar__segment--filled' : '';
    return `<div class="progress-bar__segment ${cls}"></div>`;
  }).join('');

  const decisionsContent = recentDecisions.length
    ? `<table class="table">
         <thead><tr>
           <th>Time</th><th>Hook</th><th>Decision</th><th>Reason</th><th>Session</th>
         </tr></thead>
         <tbody>${recentDecisions.map(decisionRow).join('')}</tbody>
       </table>`
    : `<div class="empty" style="padding: var(--space-xl)">
         <div class="empty__title">No recent decisions</div>
         <div class="empty__desc">Hook decisions appear here as agents interact</div>
       </div>`;

  return `
    <div class="main__header">
      <h1 class="main__title">Hook Pipeline</h1>
      <span class="main__subtitle">${hookCount} HOOKS · MODE: ${mode.toUpperCase()} · ${activeCount} ACTIVE</span>
    </div>

    <div class="card" style="margin-bottom: var(--space-xl)">
      <div class="card__label">PIPELINE STATUS</div>
      <div style="margin: var(--space-md) 0">
        <div class="progress-bar progress-bar--hero">${pipelineSegments}</div>
      </div>
      <div style="display: flex; gap: 2px; margin-bottom: var(--space-md)">
        ${hooks.map(h => {
          const label = (h.name || '').replace(/-/g, ' ').slice(0, 10).toUpperCase();
          return `<div style="flex: 1; text-align: center"><span class="stat-row__label" style="font-size: 10px">${label}</span></div>`;
        }).join('')}
      </div>
    </div>

    <div class="grid-2" style="margin-bottom: var(--space-xl)">
      <div class="card">
        <div class="card__label">REGISTERED HOOKS</div>
        <div style="margin-top: var(--space-sm)">
          ${hooks.map((h, i) => hookRow(h, i)).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card__label">ENFORCEMENT</div>
        <div class="stat-row">
          <span class="stat-row__label">MODE</span>
          <span class="stat-row__value">${modeTag(mode)}</span>
        </div>
        <div class="stat-row">
          <span class="stat-row__label">HOOKS REGISTERED</span>
          <span class="stat-row__value">${hookCount}</span>
        </div>
        <div class="stat-row">
          <span class="stat-row__label">DECISIONS LOGGED</span>
          <span class="stat-row__value">${recentDecisions.length}</span>
        </div>
        ${riskDist ? `
        <div style="margin-top: var(--space-lg)">
          <div class="card__label">RISK TIER DISTRIBUTION</div>
          <div style="margin-top: var(--space-sm)">
            ${riskDistributionInline(riskDist)}
          </div>
        </div>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card__label">RECENT DECISIONS</div>
      <div style="margin-top: var(--space-sm)">
        ${decisionsContent}
      </div>
    </div>`;
}

registerView('hooks', render);
