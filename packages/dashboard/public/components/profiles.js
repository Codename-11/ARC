// ARC Dashboard — Profiles View
import { api } from '../scripts/api.js';
import { registerView } from '../scripts/router.js';

const TOOL_LABELS = {
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  codex: 'Codex CLI',
};

function toolLabel(tool) {
  return TOOL_LABELS[tool] || tool || 'unknown';
}

function authTag(authType) {
  const label = (authType || 'unknown').toUpperCase();
  return `<span class="tag">${label}</span>`;
}

function activeDot(isActive) {
  if (!isActive) return '';
  return `<div style="width: 6px; height: 6px; border-radius: 50%; background: var(--success); display: inline-block; margin-right: var(--space-xs)"></div>`;
}

function profileCard(profile) {
  const borderStyle = profile.active
    ? 'border-color: var(--success)'
    : '';

  return `
    <div class="card" style="${borderStyle}">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-md)">
        <div class="card__label">${profile.name}</div>
        <div class="phase">
          ${activeDot(profile.active)}
          <span class="phase__text">${profile.active ? 'ACTIVE' : 'IDLE'}</span>
        </div>
      </div>
      <div class="stat-row">
        <span class="stat-row__label">TOOL</span>
        <span class="stat-row__value">${toolLabel(profile.tool)}</span>
      </div>
      <div class="stat-row">
        <span class="stat-row__label">AUTH</span>
        <span class="stat-row__value">${authTag(profile.authType)}</span>
      </div>
      <div class="stat-row">
        <span class="stat-row__label">SHARED LAYER</span>
        <span class="stat-row__value${profile.useShared ? ' stat-row__value--success' : ''}">${profile.useShared ? 'ON' : 'OFF'}</span>
      </div>
      ${profile.inherits ? `
      <div class="stat-row">
        <span class="stat-row__label">INHERITS</span>
        <span class="stat-row__value" style="color: var(--text-secondary)">${profile.inherits}</span>
      </div>` : ''}
      ${profile.description ? `<div class="card__meta">${profile.description}</div>` : ''}
      ${profile.createdAt ? `<div class="card__meta">Created: ${new Date(profile.createdAt).toLocaleDateString()}</div>` : ''}
    </div>`;
}

async function render() {
  let profiles;
  try {
    profiles = await api.profiles();
  } catch {
    profiles = [];
  }

  if (!profiles.length) {
    return `
      <div class="main__header">
        <h1 class="main__title">Profiles</h1>
        <span class="main__subtitle">IDENTITY MANAGEMENT</span>
      </div>
      <div class="empty">
        <div class="empty__title">No profiles configured</div>
        <div class="empty__desc">Create profiles via arc init or the TUI onboarding wizard</div>
      </div>`;
  }

  const activeCount = profiles.filter(p => p.active).length;
  const toolCounts = profiles.reduce((acc, p) => {
    const t = toolLabel(p.tool);
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const toolSummary = Object.entries(toolCounts)
    .map(([tool, count]) => `${count} ${tool}`)
    .join(' · ');

  return `
    <div class="main__header">
      <h1 class="main__title">Profiles</h1>
      <span class="main__subtitle">${profiles.length} REGISTERED · ${toolSummary}</span>
    </div>
    <div class="grid-3">${profiles.map(profileCard).join('')}</div>`;
}

registerView('profiles', render);
