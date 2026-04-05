// ARC Dashboard — Agents View
import { api } from '../scripts/api.js';
import { registerView, navigateTo } from '../scripts/router.js';
import { escapeHtml } from '../scripts/utils.js';

function statusDot(status) {
  const color = status === 'online' ? 'var(--success)' :
                status === 'offline' ? 'var(--text-disabled)' : 'var(--warning)';
  return `<div style="width: 6px; height: 6px; border-radius: 50%; background: ${color}; display: inline-block; margin-right: var(--space-xs)"></div>`;
}

function agentCard(agent) {
  return `
    <div class="card">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-md)">
        <div class="card__label">${escapeHtml(agent.name || agent.id?.slice(0, 8))}</div>
        <div class="phase">
          ${statusDot(agent.status)}
          <span class="phase__text">${escapeHtml((agent.status || 'unknown').toUpperCase())}</span>
        </div>
      </div>
      <div class="stat-row">
        <span class="stat-row__label">TRANSPORT</span>
        <span class="stat-row__value">${escapeHtml(agent.transport || '—')}</span>
      </div>
      <div class="stat-row">
        <span class="stat-row__label">ENDPOINT</span>
        <span class="stat-row__value" style="font-size: var(--caption); color: var(--text-secondary)">${escapeHtml(agent.endpoint || '—')}</span>
      </div>
      <div class="stat-row">
        <span class="stat-row__label">PROFILE</span>
        <span class="stat-row__value">${escapeHtml(agent.profile || '—')}</span>
      </div>
      ${agent.lastSeen ? `<div class="card__meta">Last seen: ${escapeHtml(new Date(agent.lastSeen).toLocaleString())}</div>` : ''}
      <div style="margin-top: var(--space-sm); display: flex; gap: var(--space-xs)">
        <button class="btn--ghost caption agent-health-btn" data-id="${escapeHtml(agent.id)}">CHECK</button>
        <button class="btn--ghost caption agent-remove-btn" data-id="${escapeHtml(agent.id)}">REMOVE</button>
      </div>
    </div>`;
}

function attachActionHandlers() {
  document.querySelectorAll('.agent-health-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await api.checkAgentHealth(id);
        navigateTo('agents');
      } catch (err) {
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll('.agent-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await api.removeAgent(id);
        navigateTo('agents');
      } catch (err) {
        btn.disabled = false;
      }
    });
  });
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

  // Attach action handlers after DOM update
  setTimeout(attachActionHandlers, 0);

  return `
    <div class="main__header">
      <h1 class="main__title">Agents</h1>
      <span class="main__subtitle">${online} ONLINE · ${agents.length} REGISTERED</span>
    </div>
    <div class="grid-3">${agents.map(agentCard).join('')}</div>`;
}

registerView('agents', render);
