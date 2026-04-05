import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

export default withMermaid(defineConfig({
  title: 'ARC',
  description: 'Agent Runtime Control — unified control plane for AI coding agents',
  base: '/docs/',

  head: [
    // Favicon
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['link', { rel: 'apple-touch-icon', href: '/logo.svg' }],

    // Open Graph
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'ARC — Agent Runtime Control' }],
    ['meta', { property: 'og:description', content: 'Unified control plane for AI coding agents. Profiles, supervision, hooks, memory, tasks, telemetry, and a web dashboard.' }],
    ['meta', { property: 'og:image', content: '/og-image.svg' }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],

    // Twitter Card
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'ARC — Agent Runtime Control' }],
    ['meta', { name: 'twitter:description', content: 'Unified control plane for AI coding agents. Profiles, supervision, hooks, memory, tasks, and a web dashboard.' }],
    ['meta', { name: 'twitter:image', content: '/og-image.svg' }],

    // Theme
    ['meta', { name: 'theme-color', content: '#000000' }],

    // Fonts
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;700&family=Space+Mono:wght@400;700&display=swap', rel: 'stylesheet' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'Features', link: '/features/' },
      { text: 'Architecture', link: '/architecture/' },
      { text: 'Reference', link: '/reference/cli' },
      { text: 'FAQ', link: '/guide/faq' },
      { text: 'GitHub', link: 'https://github.com/Codename-11/ARC' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is ARC?', link: '/guide/' },
            { text: 'Getting Started', link: '/guide/getting-started' },
          ],
        },
        {
          text: 'Profiles & Auth',
          items: [
            { text: 'Profiles', link: '/guide/profiles' },
            { text: 'Authentication', link: '/guide/authentication' },
            { text: 'Multi-Account', link: '/guide/multi-account' },
          ],
        },
        {
          text: 'Agent Runtimes',
          items: [
            { text: 'OpenClaw', link: '/guide/openclaw' },
            { text: 'Hermes Agent', link: '/guide/hermes' },
          ],
        },
        {
          text: 'Integration',
          items: [
            { text: 'Shell Integration', link: '/guide/shell-integration' },
          ],
        },
        {
          text: 'Help',
          items: [
            { text: 'Troubleshooting', link: '/guide/troubleshooting' },
            { text: 'FAQ', link: '/guide/faq' },
            { text: 'Contributing', link: '/guide/contributing' },
          ],
        },
      ],
      '/features/': [
        {
          text: 'Core Features',
          items: [
            { text: 'Overview', link: '/features/' },
            { text: 'Hooks & Supervision', link: '/features/hooks' },
            { text: 'Secrets & Credentials', link: '/features/secrets' },
            { text: 'Permission Model', link: '/features/permissions' },
          ],
        },
        {
          text: 'Data & Automation',
          items: [
            { text: 'Tasks', link: '/features/tasks' },
            { text: 'Memory', link: '/features/memory' },
            { text: 'Skills', link: '/features/skills' },
            { text: 'Sessions', link: '/features/sessions' },
          ],
        },
        {
          text: 'Infrastructure',
          items: [
            { text: 'Web Dashboard', link: '/features/dashboard' },
            { text: 'Cloud Sync', link: '/features/sync' },
            { text: 'Telemetry', link: '/features/telemetry' },
            { text: 'Plugins', link: '/features/plugins' },
            { text: 'Remote Agents', link: '/features/remote' },
          ],
        },
        {
          text: 'Advanced',
          items: [
            { text: 'Multi-Agent Orchestration', link: '/features/orchestration' },
            { text: 'Credential Hot-Swap', link: '/features/swap' },
            { text: 'Dark Factory', link: '/features/factory' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/' },
            { text: 'Adapters', link: '/architecture/adapters' },
            { text: 'Hook Pipeline', link: '/architecture/hooks' },
            { text: 'MCP Protocol', link: '/architecture/mcp' },
            { text: 'Packages', link: '/architecture/packages' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'CLI Commands', link: '/reference/cli' },
            { text: 'Configuration', link: '/reference/configuration' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Codename-11/ARC' },
    ],

    footer: {
      message: 'Built with ❤️ by <a href="https://axiom-labs.cloud">Axiom-Labs</a>',
      copyright: '<a href="https://arc-cli.dev">arc-cli.dev</a> · MIT License',
    },

    search: {
      provider: 'local',
    },
  },

  vite: {
    optimizeDeps: {
      include: ['mermaid', 'dayjs'],
    },
    ssr: {
      noExternal: ['vitepress-plugin-mermaid', 'mermaid'],
    },
  },

  mermaid: {
    theme: 'dark',
    themeVariables: {
      primaryColor: '#1A1A1A',
      primaryTextColor: '#E8E8E8',
      primaryBorderColor: '#333333',
      lineColor: '#2563EB',
      secondaryColor: '#111111',
      tertiaryColor: '#0A0A0A',
      fontSize: '13px',
      fontFamily: '"Space Mono", monospace',
    },
  },
}));
