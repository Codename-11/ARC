// ARC Dashboard — Overview View
import { api } from '../scripts/api.js';
import { registerView } from '../scripts/router.js';

function heroCard(label, value, unit, status) {
  const colorClass = status === 'ok' ? '' : status === 'warn' ? ' stat-row__value--warning' : status === 'error' ? ' stat-row__value--error' : '';
  return `
    <div class="card">
      <div class="card__label">${label}</div>
      <div class="card__value${colorClass}">${value}<span class="card__unit">${unit}</span></div>
    </div>`;
}

function segmentedBar(filled, total, status) {
  const segments = [];
  for (let i = 0; i < total; i++) {
    const cls = i < filled
      ? `progress-bar__segment--${status || 'filled'}`
      : '';
    segments.push(`<div class="progress-bar__segment ${cls}"></div>`);
  }
  return `<div class="progress-bar progress-bar--hero">${segments.join('')}</div>`;
}

function statRow(label, value, status) {
  const cls = status ? ` stat-row__value--${status}` : '';
  return `
    <div class="stat-row">
      <span class="stat-row__label">${label}</span>
      <span class="stat-row__value${cls}">${value}</span>
    </div>`;
}

async function render() {
  let data;
  try {
    data = await api.overview();
  } catch {
    data = { sessions: { active: 0, total: 0 }, tasks: { working: 0, completed: 0, total: 0 }, skills: { total: 0 }, agents: { online: 0, total: 0 }, factory: null, health: 'ok' };
  }

  const s = data.sessions || {};
  const t = data.tasks || {};
  const sk = data.skills || {};
  const a = data.agents || {};
  const healthStatus = data.health === 'fail' ? 'error' : data.health === 'warn' ? 'warn' : 'ok';
  const taskProgress = t.total > 0 ? Math.round((t.completed / t.total) * 10) : 0;

  return `
    <div class="main__header">
      <h1 class="main__title">Overview</h1>
      <span class="main__subtitle">AGENT RUNTIME CONTROL</span>
    </div>

    <div class="grid-4" style="margin-bottom: var(--space-xl)">
      ${heroCard('ACTIVE SESSIONS', s.active || 0, '', healthStatus)}
      ${heroCard('TASKS', t.working || 0, 'WORKING', '')}
      ${heroCard('SKILLS', sk.total || 0, 'LOADED', '')}
      ${heroCard('AGENTS', a.online || 0, 'ONLINE', a.online > 0 ? 'ok' : '')}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card__label">TASK COMPLETION</div>
        <div style="margin: var(--space-md) 0">
          ${segmentedBar(taskProgress, 10, taskProgress >= 8 ? 'success' : taskProgress >= 5 ? 'warning' : 'filled')}
        </div>
        <div class="card__meta">${t.completed || 0} / ${t.total || 0} completed</div>
      </div>
      <div class="card">
        <div class="card__label">SYSTEM STATUS</div>
        ${statRow('Health', data.health?.toUpperCase() || 'OK', healthStatus)}
        ${statRow('Sessions', `${s.active || 0} active / ${s.total || 0} total`)}
        ${statRow('Factory', data.factory?.status?.toUpperCase() || 'IDLE')}
      </div>
    </div>`;
}

registerView('overview', render);
