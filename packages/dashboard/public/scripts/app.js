// ARC Dashboard — App Entry
import { api } from './api.js';
import { ws } from './ws.js';
import { navigateTo, getActiveView } from './router.js';

// Components self-register via registerView() on import

// ── Sidebar Navigation ──
document.querySelectorAll('.sidebar__item').forEach(el => {
  el.addEventListener('click', () => navigateTo(el.dataset.view));
});

// ── Theme Toggle ──
const toggle = document.getElementById('theme-toggle');
toggle?.addEventListener('click', () => {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  toggle.textContent = next === 'dark' ? 'LIGHT' : 'DARK';
});

// ── Health Indicator ──
const dot = document.getElementById('health-dot');
const text = document.getElementById('health-text');

async function updateHealth() {
  try {
    const h = await api.health();
    dot?.classList.remove('topbar__dot--warn', 'topbar__dot--error');
    if (text) text.textContent = 'CONNECTED';
  } catch {
    dot?.classList.add('topbar__dot--error');
    if (text) text.textContent = 'OFFLINE';
  }
}

// ── WebSocket Events ──
ws.on('connected', () => {
  dot?.classList.remove('topbar__dot--warn', 'topbar__dot--error');
  if (text) text.textContent = 'LIVE';
});

ws.on('disconnected', () => {
  dot?.classList.add('topbar__dot--warn');
  if (text) text.textContent = 'RECONNECTING';
});

// Refresh active view on real-time updates
ws.on('update', () => {
  if (document.querySelector('.modal-overlay')) return; // Don't destroy modal state
  const view = getActiveView();
  if (view) navigateTo(view);
});

// ── Init ──
navigateTo('overview');
updateHealth();
ws.connect();

// Periodic health check
setInterval(updateHealth, 30000);
