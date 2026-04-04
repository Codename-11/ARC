import DefaultTheme from 'vitepress/theme';
import './custom.css';
import { h } from 'vue';

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-after': () =>
        h('div', { class: 'doc-footer-cta' }, [
          h('hr'),
          h('p', {
            innerHTML:
              '<strong>[?]</strong> <a href="https://github.com/Codename-11/ARC/discussions">Questions</a> · <strong>[!]</strong> <a href="https://github.com/Codename-11/ARC/issues/new">Report Issue</a> · <strong>[+]</strong> <a href="/guide/contributing">Contribute</a>',
          }),
        ]),
    });
  },
};
