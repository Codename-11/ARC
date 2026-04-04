// ARC Dashboard — Plugins View
import { api } from '../scripts/api.js';
import { registerView } from '../scripts/router.js';

// TODO: Replace placeholder data with live API call once /api/plugins endpoint exists

function pluginCard(plugin) {
  const enabled = plugin.status === 'enabled';
  const statusColor = enabled ? 'var(--success)' : 'var(--text-disabled)';
  const statusDot = `<div style="width: 6px; height: 6px; border-radius: 50%; background: ${statusColor}; display: inline-block; margin-right: var(--space-xs)"></div>`;

  return `
    <div class="card"${!enabled ? ' style="opacity: 0.6"' : ''}>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-md)">
        <div class="card__label">${plugin.name}</div>
        <div class="phase">
          ${statusDot}
          <span class="phase__text" style="color: ${statusColor}">${plugin.status.toUpperCase()}</span>
        </div>
      </div>
      <div class="stat-row">
        <span class="stat-row__label">VERSION</span>
        <span class="stat-row__value">${plugin.version}</span>
      </div>
      <div class="stat-row">
        <span class="stat-row__label">SOURCE</span>
        <span class="stat-row__value" style="color: var(--text-secondary)">${plugin.source}</span>
      </div>
      ${plugin.description ? `<div class="card__meta">${plugin.description}</div>` : ''}
    </div>`;
}

async function render() {
  let plugins;
  try {
    plugins = await api.plugins();
  } catch {
    plugins = null;
  }

  // TODO: Use live data when available; for now show placeholder
  if (!plugins) {
    plugins = [
      { name: 'arc-plugin-git',      version: '1.2.0', status: 'enabled',  source: 'npm', description: 'Git integration and auto-commit hooks' },
      { name: 'arc-plugin-docker',   version: '0.9.1', status: 'enabled',  source: 'npm', description: 'Container management for agent environments' },
      { name: 'arc-plugin-metrics',  version: '2.0.0', status: 'enabled',  source: 'npm', description: 'Performance metrics and telemetry collection' },
      { name: 'arc-plugin-custom',   version: '0.1.0', status: 'disabled', source: 'local', description: 'Custom workspace automation scripts' },
    ];
  }

  const enabled = plugins.filter(p => p.status === 'enabled').length;
  const total = plugins.length;

  if (!total) {
    return `
      <div class="main__header">
        <h1 class="main__title">Plugins</h1>
        <span class="main__subtitle">EXTENSION REGISTRY</span>
      </div>
      <div class="empty">
        <div class="empty__title">No plugins installed</div>
        <div class="empty__desc">Install plugins via arc plugins add &lt;name&gt;</div>
      </div>`;
  }

  return `
    <div class="main__header">
      <h1 class="main__title">Plugins</h1>
      <span class="main__subtitle">${enabled} ENABLED · ${total} INSTALLED</span>
    </div>
    <div class="grid-3">${plugins.map(pluginCard).join('')}</div>`;
}

registerView('plugins', render);
