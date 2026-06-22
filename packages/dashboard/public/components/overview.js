// ARC Dashboard — Overview View
import { api } from '../scripts/api.js';
import { registerView } from '../scripts/router.js';
import { escapeHtml } from '../scripts/utils.js';
import { ensureArcClient } from './arc-client-bridge.js';

/**
 * Fetch daemon-side health + agent summary via the WS SDK when possible.
 * Returns null when the daemon isn't reachable — callers fall back to
 * the HTTP-backed /api/overview route.
 */
async function loadDaemonSnapshot() {
  const client = await ensureArcClient();
  if (!client) return null;
  try {
    const [health, agents] = await Promise.all([
      client.call('health.get'),
      client.call('agent.list'),
    ]);
    return { health, agents: Array.isArray(agents?.agents) ? agents.agents : [] };
  } catch {
    return null;
  }
}

function heroCard(label, value, unit, status) {
  const colorClass = status === 'ok' ? '' : status === 'warn' ? ' stat-row__value--warning' : status === 'error' ? ' stat-row__value--error' : '';
  return `
    <div class="card">
      <div class="card__label">${escapeHtml(label)}</div>
      <div class="card__value${colorClass}">${escapeHtml(String(value))}<span class="card__unit">${escapeHtml(unit)}</span></div>
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
      <span class="stat-row__label">${escapeHtml(label)}</span>
      <span class="stat-row__value${cls}">${escapeHtml(String(value))}</span>
    </div>`;
}

// ── Hook Pipeline (static placeholder) ──
// TODO: Replace with real hook telemetry from /api/overview when available

// TODO: Wire to real hook runner state via /api/hooks endpoint
// Idle state — all stages pending until a hook actually runs
const hookPipelineStages = [
  { label: 'PREFLIGHT',  status: 'pending', color: 'var(--text-disabled)' },
  { label: 'VALIDATE',   status: 'pending', color: 'var(--text-disabled)' },
  { label: 'POSTFLIGHT', status: 'pending', color: 'var(--text-disabled)' },
  { label: 'COMPLETE',   status: 'pending', color: 'var(--text-disabled)' },
];

function pipelineBar(stages) {
  const segments = stages.map(stage => {
    const cls = stage.status === 'success'
      ? 'progress-bar__segment--success'
      : stage.status === 'warning'
        ? 'progress-bar__segment--warning'
        : '';
    return `<div class="progress-bar__segment ${cls}"></div>`;
  });
  return `<div class="progress-bar progress-bar--hero">${segments.join('')}</div>`;
}

// ── Phase detection from trace action fields ──

/**
 * Maps trace action prefixes to phase labels.
 * Mirrors the TOOL_PHASE_MAP logic from packages/core/src/phase-indicators.ts
 * but operates on log-event action strings instead of tool names.
 */
const ACTION_PHASE_MAP = [
  // Session lifecycle
  [['session:start', 'session:create', 'core:init'], { phase: 'thinking', verb: 'Thinking' }],
  // Tool use actions
  [['tool:read', 'tool:grep', 'tool:glob', 'tool:search'], { phase: 'reading', verb: 'Reading' }],
  [['tool:write', 'tool:edit', 'tool:patch', 'tool:create'], { phase: 'writing', verb: 'Writing' }],
  [['tool:test', 'tool:jest', 'tool:vitest'], { phase: 'testing', verb: 'Testing' }],
  [['tool:deploy', 'tool:publish', 'tool:release'], { phase: 'deploying', verb: 'Deploying' }],
  [['tool:review', 'tool:diff', 'tool:lint', 'tool:audit'], { phase: 'reviewing', verb: 'Reviewing' }],
  [['tool:bash', 'tool:shell', 'tool:exec', 'tool:run', 'tool:use'], { phase: 'executing', verb: 'Executing' }],
  // Hook pipeline
  [['hook:'], { phase: 'reviewing', verb: 'Reviewing' }],
  // Permission / auth
  [['permission:', 'auth:'], { phase: 'thinking', verb: 'Thinking' }],
  // Cron / task
  [['cron:', 'task:'], { phase: 'executing', verb: 'Executing' }],
  // Dashboard
  [['dashboard:'], { phase: 'idle', verb: 'Idle' }],
  // Session end
  [['session:complete', 'session:end'], { phase: 'idle', verb: 'Idle' }],
];

function detectPhaseFromAction(action) {
  if (!action) return { phase: 'idle', verb: 'Idle' };

  const lower = action.toLowerCase();
  for (const [prefixes, result] of ACTION_PHASE_MAP) {
    for (const prefix of prefixes) {
      if (lower === prefix || lower.startsWith(prefix)) {
        return result;
      }
    }
  }

  return { phase: 'thinking', verb: 'Thinking' };
}

function traceRow(trace) {
  const { phase, verb } = detectPhaseFromAction(trace.action);
  const isActive = phase !== 'idle';
  const dotClass = isActive ? ' phase__dot--active' : '';
  const time = trace.timestamp
    ? new Date(trace.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';
  const msg = trace.message || trace.action || '';

  return `
    <div class="stat-row">
      <span class="stat-row__label" style="display: inline-flex; align-items: center; gap: var(--space-sm)">
        <span class="phase">
          <span class="phase__dot${dotClass}"></span>
          <span class="phase__text">${escapeHtml(verb)}</span>
        </span>
        <span style="color: var(--text-disabled)">${escapeHtml(time)}</span>
      </span>
      <span class="stat-row__value" style="max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${escapeHtml(msg)}</span>
    </div>`;
}

async function render() {
  // Fetch overview, traces, hooks, and (if the daemon is up) its snapshot
  // in parallel. Any failure falls back to empty / defaults.
  const [overviewResult, tracesResult, hooksResult, daemonResult] = await Promise.allSettled([
    api.overview(),
    api.traces('', 5),
    api.hooks(),
    loadDaemonSnapshot(),
  ]);

  const data = overviewResult.status === 'fulfilled' ? overviewResult.value : { sessions: { active: 0, total: 0 }, tasks: { working: 0, completed: 0, total: 0 }, skills: { total: 0 }, agents: { online: 0, total: 0 }, factory: null, health: 'ok' };
  let traces = tracesResult.status === 'fulfilled' ? tracesResult.value : [];
  if (!Array.isArray(traces)) traces = [];
  const hooks = hooksResult.status === 'fulfilled' ? hooksResult.value : null;
  const daemon = daemonResult.status === 'fulfilled' ? daemonResult.value : null;

  // Prefer daemon-reported agent/health numbers when available — these are
  // the canonical v3 source-of-truth; the HTTP /api/overview path is a
  // legacy snapshot from ~/.arc/*.json.
  if (daemon) {
    const running = daemon.agents.filter((a) => a.status === 'running').length;
    data.agents = { ...(data.agents ?? {}), online: running, total: daemon.agents.length };
    if (daemon.health?.ok) data.health = 'ok';
  }

  const s = data.sessions || {};
  const t = data.tasks || {};
  const sk = data.skills || {};
  const a = data.agents || {};
  const healthStatus = data.health === 'fail' ? 'error' : data.health === 'warn' ? 'warn' : 'ok';
  const taskProgress = t.total > 0 ? Math.round((t.completed / t.total) * 10) : 0;

  // Use hook data from API if available, otherwise show idle placeholder
  const pipelineStages = hooks?.stages || hookPipelineStages;

  const liveActivityContent = traces.length > 0
    ? traces.map(traceRow).join('')
    : `<div class="stat-row"><span class="stat-row__label" style="color: var(--text-disabled)">No recent activity</span></div>`;

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

    <!-- TODO: Wire hook pipeline to real data from /api/overview once hook telemetry is available -->
    <div style="margin-bottom: var(--space-xl)">
      <div class="card">
        <div class="card__label">HOOK PIPELINE</div>
        <div style="margin: var(--space-md) 0">
          ${pipelineBar(pipelineStages)}
        </div>
        <div style="display: flex; gap: 2px; margin-bottom: var(--space-md)">
          ${pipelineStages.map(stage => `
            <div style="flex: 1; text-align: center">
              <span class="stat-row__label" style="font-size: var(--caption); color: ${stage.color}">${escapeHtml(stage.label)}</span>
            </div>`).join('')}
        </div>
        ${statRow('Mode', 'ENFORCE', 'success')}
        ${statRow('Circuit', 'CLOSED', 'success')}
      </div>
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
    </div>

    <div style="margin-top: var(--space-xl)">
      <div class="card">
        <div class="card__label">LIVE ACTIVITY</div>
        <div style="margin-top: var(--space-sm)">
          ${liveActivityContent}
        </div>
      </div>
    </div>`;
}

registerView('overview', render);
