// ARC Dashboard — Dark Factory View
import { api } from '../scripts/api.js';
import { registerView } from '../scripts/router.js';
import { escapeHtml } from '../scripts/utils.js';

function statusColor(status) {
  if (status === 'completed') return 'var(--success)';
  if (status === 'failed' || status === 'aborted') return 'var(--accent)';
  if (status === 'executing' || status === 'verifying') return 'var(--text-display)';
  return 'var(--text-secondary)';
}

function waveCard(wave, index, isCurrent) {
  const border = isCurrent ? 'border-color: var(--text-display)' : '';
  return `
    <div class="card" style="${border}">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-sm)">
        <span class="label">WAVE ${index + 1}</span>
        ${wave.verifier ? '<span class="tag tag--warning">VERIFIER</span>' : ''}
      </div>
      <div class="heading" style="margin-bottom: var(--space-sm)">${escapeHtml(wave.name)}</div>
      <div class="caption">${wave.tasks?.length || 0} task${wave.tasks?.length !== 1 ? 's' : ''}</div>
    </div>`;
}

async function render() {
  let data;
  try {
    data = await api.factory('latest');
  } catch {
    data = null;
  }

  if (!data || !data.spec) {
    return `
      <div class="main__header">
        <h1 class="main__title">Dark Factory</h1>
        <span class="main__subtitle">AUTONOMOUS EXECUTION</span>
      </div>
      <div class="empty dot-grid-subtle" style="padding: var(--space-3xl)">
        <div class="display-md" style="font-family: var(--font-display); color: var(--text-disabled); margin-bottom: var(--space-lg)">IDLE</div>
        <div class="empty__desc">No factory runs active. Start one with arc factory run --spec &lt;file&gt;</div>
      </div>`;
  }

  const waves = data.spec.waves || [];
  const currentWave = data.currentWave ?? 0;
  const results = data.waveResults || [];
  const completedWaves = results.filter(r => r.status === 'completed').length;

  // Wave progress bar
  const segments = waves.map((_, i) => {
    const result = results[i];
    const cls = result?.status === 'completed' ? 'progress-bar__segment--success' :
                result?.status === 'failed' ? 'progress-bar__segment--error' :
                i === currentWave ? 'progress-bar__segment--filled' : '';
    return `<div class="progress-bar__segment ${cls}"></div>`;
  }).join('');

  return `
    <div class="main__header">
      <h1 class="main__title">${escapeHtml(data.spec.name || 'Dark Factory')}</h1>
      <span class="main__subtitle">
        <span style="color: ${statusColor(data.status)}">${escapeHtml((data.status || 'idle').toUpperCase())}</span>
        · WAVE ${currentWave + 1} / ${waves.length}
      </span>
    </div>

    <div class="card" style="margin-bottom: var(--space-xl)">
      <div class="card__label">WAVE PROGRESS</div>
      <div style="margin: var(--space-md) 0">
        <div class="progress-bar progress-bar--hero">${segments}</div>
      </div>
      <div class="card__meta">${completedWaves} / ${waves.length} waves completed</div>
    </div>

    <div class="grid-3">
      ${waves.map((w, i) => waveCard(w, i, i === currentWave)).join('')}
    </div>

    ${data.spec.consensusGate?.enabled ? `
    <div class="card" style="margin-top: var(--space-xl)">
      <div class="card__label">CONSENSUS GATE</div>
      <div class="stat-row">
        <span class="stat-row__label">REVIEWER</span>
        <span class="stat-row__value">${escapeHtml(data.spec.consensusGate.reviewerProfile)}</span>
      </div>
      <div class="stat-row">
        <span class="stat-row__label">THRESHOLD</span>
        <span class="stat-row__value">${escapeHtml(String(data.spec.consensusGate.threshold))}</span>
      </div>
    </div>` : ''}`;
}

registerView('factory', render);
