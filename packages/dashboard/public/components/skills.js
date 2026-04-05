// ARC Dashboard — Skills View
import { api } from '../scripts/api.js';
import { registerView, navigateTo } from '../scripts/router.js';
import { escapeHtml } from '../scripts/utils.js';

function sourceTag(src) {
  const cls = src === 'generated' ? 'tag--active' :
              src === 'mcp' ? 'tag--warning' : '';
  return `<span class="tag ${cls}">${escapeHtml(src)}</span>`;
}

function successBar(rate) {
  const segments = 10;
  const filled = Math.round(rate * segments);
  const status = rate >= 0.8 ? 'success' : rate >= 0.5 ? 'warning' : 'error';
  const bars = [];
  for (let i = 0; i < segments; i++) {
    bars.push(`<div class="progress-bar__segment ${i < filled ? `progress-bar__segment--${status}` : ''}"></div>`);
  }
  return `<div class="progress-bar" style="width: 80px">${bars.join('')}</div>`;
}

function attachActionHandlers() {
  document.querySelectorAll('.skill-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      btn.disabled = true;
      try {
        await api.removeSkill(name);
        navigateTo('skills');
      } catch (err) {
        btn.disabled = false;
      }
    });
  });
}

async function render() {
  let skills;
  try {
    skills = await api.skills();
  } catch {
    skills = [];
  }

  if (!skills.length) {
    return `
      <div class="main__header">
        <h1 class="main__title">Skills</h1>
        <span class="main__subtitle">SKILL REGISTRY</span>
      </div>
      <div class="empty">
        <div class="empty__title">No skills loaded</div>
        <div class="empty__desc">Add skill definitions to ~/.arc/skills/ or use skillify</div>
      </div>`;
  }

  const rows = skills.map(s => `
    <tr>
      <td class="data">${escapeHtml(s.name)}</td>
      <td style="color: var(--text-secondary)">${escapeHtml(s.description || '—')}</td>
      <td>${sourceTag(s.source || 'user')}</td>
      <td>${s.tools?.length || 0}</td>
      <td>${successBar(s.successRate ?? 1)}</td>
      <td><button class="btn--ghost caption skill-remove-btn" data-name="${escapeHtml(s.name)}">REMOVE</button></td>
    </tr>`).join('');

  // Attach action handlers after DOM update
  setTimeout(attachActionHandlers, 0);

  return `
    <div class="main__header">
      <h1 class="main__title">Skills</h1>
      <span class="main__subtitle">${skills.length} REGISTERED</span>
    </div>
    <table class="table">
      <thead><tr>
        <th>Name</th><th>Description</th><th>Source</th><th>Tools</th><th>Success Rate</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

registerView('skills', render);
