// ARC Dashboard — View Router

const views = new Map();
let activeView = null;

export function registerView(name, renderFn) {
  views.set(name, renderFn);
}

export async function navigateTo(name) {
  const main = document.getElementById('main-content');
  if (!main) return;

  // Update sidebar active state
  document.querySelectorAll('.sidebar__item').forEach(el => {
    el.classList.toggle('sidebar__item--active', el.dataset.view === name);
  });

  const renderFn = views.get(name);
  if (!renderFn) {
    main.innerHTML = `<div class="empty"><div class="empty__title">View not found</div><div class="empty__desc">${name}</div></div>`;
    return;
  }

  main.innerHTML = '<div class="loading">[LOADING...]</div>';
  activeView = name;

  try {
    const html = await renderFn();
    if (activeView === name) main.innerHTML = html;
  } catch (err) {
    if (activeView === name) {
      main.innerHTML = `<div class="empty"><div class="empty__title">[ERROR]</div><div class="empty__desc">${err.message}</div></div>`;
    }
  }
}

export function getActiveView() {
  return activeView;
}
