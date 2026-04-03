// ARC Dashboard — Agents View
import { api } from '../scripts/api.js';
import { registerView } from '../scripts/router.js';

function statusDot(status) {
  const color = status === 'online' ? 'var(--success)' :
                status === 'offline' ? 'var(--text-disabled)' : 'var(--warning)';
  return `<div style="width: 6px; height: 6px; border-radius: 50%; background: ${color}; display: inline-block; margin-right: var(--space-xs)"></div>`;
}

function agentCard(agent) {
  return `
    <div class="card">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-md)">
        <div class="card__label">${agent.name || agent.id?.slice(0, 8)}</div>
        <div class="phase">
          ${statusDot(agent.status)}
          <span class="phase__text">${(agent.status || 'unknown').toUpperCase()}</span>
        </div>
      </div>
      <div class="stat-row">
        <span class="stat-row__label">TRANSPORT</span>
        <span class="stat-row__value">${agent.transport || '—'}</span>
      </div>
      <div class="stat-row">
        <span class="stat-row__label">ENDPOINT</span>
        <span class="stat-row__value" style="font-size: var(--caption); color: var(--text-secondary)">${agent.endpoint || '—'}</span>
      </div>
      <div class="stat-row">
        <span class="stat-row__label">PROFILE</span>
        <span class="stat-row__value">${agent.profile || '—'}</span>
      </div>
      ${agent.lastSeen ? `<div class="card__meta">Last seen: ${new Date(agent.lastSeen).toLocaleString()}</div>` : ''}
    </div>`;
}

async function render() {
  let agents;
  try {
    agents = await api.agents();
  } catch {
    agents = [];
  }

  if (!agents.length) {
    return `
      <div class="main__header">
        <h1 class="main__title">Agents</h1>
        <span class="main__subtitle">REMOTE AGENT REGISTRY</span>
      </div>
      <div class="empty">
        <div class="empty__title">No remote agents registered</div>
        <div class="empty__desc">Register agents via arc remote add or A2A discovery</div>
      </div>`;
  }

  const online = agents.filter(a => a.status === 'online').length;

  return `
    <div class="main__header">
      <h1 class="main__title">Agents</h1>
      <span class="main__subtitle">${online} ONLINE · ${agents.length} REGISTERED</span>
    </div>
    <div class="grid-3">${agents.map(agentCard).join('')}</div>`;
}

registerView('agents', render);
