// ARC Dashboard — Risk Distribution View
import { api } from '../scripts/api.js';
import { registerView } from '../scripts/router.js';

function riskBar(tier, count, max) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  const color = tier === 'destructive' ? 'var(--accent)' :
                tier === 'deploy-affecting' ? 'var(--warning)' :
                tier === 'build-affecting' ? 'var(--warning)' :
                tier === 'file-modification' ? 'var(--text-primary)' :
                'var(--text-disabled)';
  return `
    <div style="margin-bottom: var(--space-md)">
      <div style="display: flex; justify-content: space-between; margin-bottom: var(--space-xs)">
        <span class="label">${tier}</span>
        <span class="data caption">${count}</span>
      </div>
      <div style="height: 8px; background: var(--border); width: 100%">
        <div style="height: 100%; width: ${pct}%; background: ${color}; transition: width var(--duration-transition) var(--ease)"></div>
      </div>
    </div>`;
}

async function render() {
  let data;
  try {
    data = await api.risk();
  } catch {
    data = {};
  }

  const tiers = ['read-only', 'file-modification', 'build-affecting', 'deploy-affecting', 'destructive'];
  const counts = tiers.map(t => ({ tier: t, count: data[t] || 0 }));
  const max = Math.max(...counts.map(c => c.count), 1);
  const total = counts.reduce((s, c) => s + c.count, 0);

  return `
    <div class="main__header">
      <h1 class="main__title">Risk Distribution</h1>
      <span class="main__subtitle">${total} CLASSIFIED EVENTS</span>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card__label">BY TIER</div>
        <div style="margin-top: var(--space-md)">
          ${counts.map(c => riskBar(c.tier, c.count, max)).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card__label">SUMMARY</div>
        <div class="card__value display-lg" style="margin: var(--space-md) 0; font-family: var(--font-display)">${total}</div>
        <div class="card__meta">Total risk events classified</div>
        <div style="margin-top: var(--space-lg)">
          <div class="stat-row">
            <span class="stat-row__label">HIGHEST TIER</span>
            <span class="stat-row__value${counts.find(c => c.tier === 'destructive')?.count ? ' stat-row__value--error' : ''}">${counts.filter(c => c.count > 0).pop()?.tier?.toUpperCase() || 'NONE'}</span>
          </div>
        </div>
      </div>
    </div>`;
}

registerView('risk', render);
