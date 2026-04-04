# @axiom-labs/arc-dashboard

> Web dashboard for ARC -- HTTP API, WebSocket real-time updates, and a Nothing-designed frontend.

Part of the [ARC](https://arc-cli.dev) monorepo ([GitHub](https://github.com/Codename-11/ARC)) -- Agent Runtime Control.

## What This Package Does

Provides a lightweight web dashboard built on raw `node:http` (no Express). Exposes 10 REST API endpoints for querying sessions, tasks, skills, memory, agents, traces, risk distribution, and factory state. Includes a WebSocket server for real-time event streaming and serves a Nothing-designed static frontend.

## Main Exports

- **`createDashboardServer(options)`** -- Creates and returns the HTTP server with all routes and WebSocket support wired up
- **`createApiHandlers(ctx)`** -- Factory that produces route handlers for all 10 API endpoints
- **`WebSocketServer`** -- WebSocket server for pushing real-time events to connected clients
- **`WebSocketClient`** -- WebSocket client for programmatic connections to the dashboard
- **Type exports** -- `DashboardServer`, `DashboardOptions`, `DashboardContext`, `HttpMethod`, `RouteHandler`, `Route`, `ConnectionHandler`

**API Endpoints:**
- `GET /api/health` -- Server health and uptime
- `GET /api/overview` -- Aggregate counts for profiles, tasks, skills, agents, and factory
- `GET /api/sessions` -- List sessions with optional profile filter
- `GET /api/traces` -- Query execution traces with session filter and limit
- `GET /api/risk/distribution` -- Risk tier distribution across tasks
- `GET /api/tasks` -- List tasks with status and assignee filters
- `GET /api/skills` -- List registered skills
- `GET /api/memory` -- Query memory entries by scope and type
- `GET /api/agents` -- List remote agents and their status
- `GET /api/factory/:runId` -- Factory controller state for a run

## Usage

```typescript
import { createDashboardServer } from "@axiom-labs/arc-dashboard";

const server = createDashboardServer({
  port: 3000,
  sessions: sessionStore,
  tasks: taskStore,
  skills: skillRegistry,
});

server.listen();
```

## Development

```bash
cd packages/dashboard
pnpm typecheck
pnpm build
```

## License

MIT
