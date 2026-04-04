# Web Dashboard

A browser-based dashboard for monitoring and managing ARC from any device on your network. Built with the Nothing design system — OLED dark mode, Space Grotesk/Space Mono typography, and a minimal technical aesthetic.

## Starting the Dashboard

```bash
arc web                    # Start on default port (3000)
arc web --port 4000        # Custom port
arc web --host 0.0.0.0    # Expose on network
```

::: tip
The dashboard binds to `localhost` by default. Pass `--host 0.0.0.0` to expose it on your local network.
:::

## Development Mode

```bash
pnpm dev:dashboard         # Hot-reload from source
```

## Architecture

The dashboard is a standalone package at `packages/dashboard/` built on raw `node:http` — no Express dependency.

### REST API

10 endpoints under `/api/*`:

| Endpoint | Description |
|----------|-------------|
| `/api/overview` | System overview (profiles, active session, health) |
| `/api/sessions` | Session list and details |
| `/api/traces` | Execution trace history |
| `/api/risk` | Risk classification results |
| `/api/tasks` | Task list and CRUD |
| `/api/skills` | Loaded skill registry |
| `/api/memory` | Memory entries and search |
| `/api/agents` | Remote agent registry |
| `/api/factory` | Dark Factory state and waves |
| `/api/health` | Health check endpoint |

### WebSocket

Real-time event push over WebSocket (RFC 6455). Events include:

- Profile switches
- Task status changes
- Session lifecycle events
- Factory wave progression
- Risk alerts

The SPA frontend auto-reconnects on WebSocket disconnection.

## Frontend Views

The SPA includes 13 modular view components:

| View | Description |
|------|-------------|
| **Overview** | System dashboard with stat rows and status indicators |
| **Sessions** | Active and suspended sessions with timeline |
| **Traces** | Execution trace inspector with filtering |
| **Risk** | Risk classification breakdown with segmented bars |
| **Tasks** | Task board with status and priority grouping |
| **Skills** | Loaded skill registry with trigger info |
| **Memory** | Memory browser with search and scope filtering |
| **Agents** | Remote agent registry with health status |
| **Factory** | Dark Factory wave progression and consensus gates |
| **Profiles** | Profile list with auth status and active indicator |
| **Diagnostics** | System health checks and environment info |
| **Sync** | Shared layer sync status and conflict resolution |
| **Plugins** | Plugin registry with install/enable/disable controls |

::: info TUI Sidebar
The TUI dashboard has 12 sidebar views: Dash, Work, Profiles, Doctor, Tasks, Memory, Skills, Settings, Guide, Sync, Traces, and Agents.
:::

## Design

The dashboard uses ARC's Nothing-inspired design system:

- **Typography** — Space Grotesk (body), Space Mono (code, data)
- **Dark mode** — OLED black (`#000000` bg, `#111111` surfaces)
- **Light mode** — warm whites with subtle gray surfaces
- **Accent** — Red (`#D71921`) for active states and alerts
- **Data display** — segmented progress bars, stat rows, tag system, phase indicators
- **Navigation** — SPA router with view switching, dark/light toggle
