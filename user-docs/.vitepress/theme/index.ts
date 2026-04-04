import DefaultTheme from 'vitepress/theme';
import './custom.css';
import { h, onMounted } from 'vue';
import { useRouter } from 'vitepress';

// Component that patches logo + injects Home link after DOM is ready
const NavPatcher = {
  setup() {
    if (typeof window === 'undefined') return () => null;

    const router = useRouter();

    const patch = () => {
      // 1. Fix logo link: / instead of /docs/
      const logoLink = document.querySelector('.VPNavBarTitle a') as HTMLAnchorElement;
      if (logoLink && !logoLink.dataset.patched) {
        logoLink.dataset.patched = 'true';
        logoLink.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          window.location.href = '/';
        });
      }

      // 2. Inject Home link into nav (once)
      if (document.querySelector('.nav-home-injected')) return;
      const firstNavLink = document.querySelector('.VPNavBarMenu > a, .VPNavBarMenu > .VPNavBarMenuLink');
      if (!firstNavLink) return;

      const home = document.createElement('a');
      home.href = '/';
      home.className = 'VPNavBarMenuLink nav-home-injected';
      home.innerHTML = '<span class="text">Home</span>';
      home.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = '/';
      });
      firstNavLink.parentElement?.insertBefore(home, firstNavLink);
    };

    onMounted(() => {
      // Patch on mount + every navigation
      patch();
      router.onAfterRouteChanged = patch;
    });

    return () => null;
  },
};

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      // NavPatcher runs as invisible component in layout-top slot
      'layout-top': () => h(NavPatcher),
      'doc-after': () =>
        h('div', { class: 'doc-footer-cta' }, [
          h('hr'),
          h('p', {
            innerHTML:
              '<strong>[?]</strong> <a href="https://github.com/Codename-11/ARC/discussions">Questions</a> · <strong>[!]</strong> <a href="https://github.com/Codename-11/ARC/issues/new">Report Issue</a> · <strong>[+]</strong> <a href="/docs/guide/contributing">Contribute</a>',
          }),
        ]),
    });
  },
};
