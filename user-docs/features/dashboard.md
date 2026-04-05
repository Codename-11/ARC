# Web Dashboard

A browser-based dashboard for monitoring **and managing** ARC from any device on your network. All views are wired to real data with full management actions — create, update, and delete resources directly from the browser. Built with the Nothing design system — OLED dark mode, Space Grotesk/Space Mono typography, and a minimal technical aesthetic.

## Starting the Dashboard

```bash
arc web                    # Start on default port (3700)
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

14 resource endpoints under `/api/*` with read and write operations:

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/overview` | GET | System overview (profiles, active session, health, hook pipeline) |
| `/api/sessions` | GET, PATCH | Session list, complete/suspend sessions |
| `/api/traces` | GET | Execution trace history |
| `/api/risk` | GET | Risk classification results |
| `/api/tasks` | GET, POST, PATCH, DELETE | Task CRUD — create, update status, delete |
| `/api/skills` | GET, POST, DELETE | Skill registry — list, reload, remove |
| `/api/memory` | GET, POST, DELETE | Memory entries — add, search, delete |
| `/api/agents` | GET, POST, DELETE | Remote agents — add, remove, health check |
| `/api/factory` | GET, POST | Dark Factory state, waves, abort |
| `/api/profiles` | GET, PATCH, DELETE | Profile list, switch active, delete |
| `/api/plugins` | GET, PATCH | Plugin registry, enable/disable |
| `/api/health` | GET | Health check endpoint |
| `/api/hooks` | GET | Hook pipeline state — registered hooks, enforcement, decisions |
| `/api/sync` | GET, POST | Sync status, pull/push shared layer |

### WebSocket

Real-time event push over WebSocket (RFC 6455). All mutations broadcast updates to connected clients, including:

- Profile switches and deletions
- Task create, status change, and delete
- Session lifecycle events (complete, suspend)
- Factory wave progression and abort
- Risk alerts
- Memory additions and deletions
- Agent registry changes and health check results
- Plugin enable/disable state changes
- Sync pull/push progress
- Hook pipeline decisions

The SPA frontend auto-reconnects on WebSocket disconnection.

## Frontend Views

The SPA includes 14 modular view components, all wired to real data with management actions:

| View | Read | Write Actions |
|------|------|---------------|
| **Overview** | System dashboard with stat rows, status indicators, hook pipeline summary | -- |
| **Sessions** | Active and suspended sessions with timeline | Complete, suspend sessions |
| **Traces** | Execution trace inspector with filtering | -- |
| **Risk** | Risk classification breakdown with segmented bars | -- |
| **Tasks** | Task board with status and priority grouping | Create, update status, delete |
| **Skills** | Loaded skill registry with trigger info | Reload, remove skills |
| **Memory** | Memory browser with search and scope filtering | Add entries, search, delete, filter by scope/type |
| **Agents** | Remote agent registry with health status | Add, remove, health-check agents |
| **Factory** | Dark Factory wave progression and consensus gates | Abort running factory |
| **Profiles** | Profile list with auth status and active indicator | Switch active profile, delete profiles |
| **Diagnostics** | System health checks and environment info | -- |
| **Sync** | Shared layer sync status and conflict resolution | Pull/push shared layer |
| **Plugins** | Plugin registry with status indicators | Enable/disable plugins |
| **Hook Pipeline** | Live monitor — registered hooks, enforcement mode, recent decisions | -- |

::: tip
All write actions broadcast changes over WebSocket, so every connected browser tab sees updates in real time.
:::

::: info TUI Sidebar
The TUI dashboard has 12 sidebar views: Dash, Work, Profiles, Doctor, Tasks, Memory, Skills, Settings, Guide, Sync, Traces, and Agents. All views are wired to real data with keyboard-driven management actions.
:::

## Hook Pipeline Monitor

The Hook Pipeline view provides real-time visibility into ARC's supervision backbone. It displays:

- **Registered hooks** — name, priority, and current enforcement mode for each hook in the pipeline
- **Enforcement mode** — the active enforcement mode (`off`, `log`, `advise`, `enforce`) for the current profile
- **Recent decisions** — a live feed of hook evaluations with pass/flag/block results and timestamps
- **Circuit breaker state** — whether the breaker is closed (normal), open (degraded), or half-open (testing)

This view is read-only and auto-refreshes as new hook decisions arrive over WebSocket. See [Hooks & Supervision](/features/hooks) for details on configuring the hook pipeline.

## Interface Capability Matrix

ARC provides three interfaces — CLI, TUI, and Web Dashboard — with overlapping but distinct capabilities:

| Feature | CLI | TUI | Web |
|---------|:---:|:---:|:---:|
| Task CRUD | Full | Full | Full |
| Memory management | Full | Full | Full |
| Skills management | Full | Read + reload | Read + reload |
| Plugin management | Full | -- | Enable/disable |
| Remote agents | Full | Full | Full |
| Sync management | Full | Full | Full |
| Session control | Full | Interactive | Complete/suspend |
| Factory control | Status + abort | -- | Status + abort |
| Hook pipeline | Runs in-process | -- | Live monitor |
| Profile management | Full | Full | Switch + delete |

::: tip
The CLI remains the most complete interface. The TUI excels at interactive workflows with keyboard shortcuts. The Web Dashboard is best for monitoring and managing ARC from another device.
:::

## Design

The dashboard uses ARC's Nothing-inspired design system:

- **Typography** — Space Grotesk (body), Space Mono (code, data)
- **Dark mode** — OLED black (`#000000` bg, `#111111` surfaces)
- **Light mode** — warm whites with subtle gray surfaces
- **Accent** — Red (`#D71921`) for active states and alerts
- **Data display** — segmented progress bars, stat rows, tag system, phase indicators
- **Navigation** — SPA router with view switching, dark/light toggle
