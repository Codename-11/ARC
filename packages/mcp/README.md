# @axiom-labs/arc-mcp

> MCP server with supervision tools and a host manager for connecting to external MCP servers.

Part of the [ARC](https://github.com/Codename-11/ARC) monorepo -- Agent Runtime Control.

## What This Package Does

Implements an MCP (Model Context Protocol) server that exposes five supervision tools for agent safety analysis. Also provides an HTTP transport server and a host manager for connecting to and orchestrating external MCP servers as a client.

## Main Exports

**Server:**
- **`createArcMcpServer()`** -- Creates the MCP server instance with all tools registered
- **`startStdioServer()`** -- Launches the MCP server over stdio transport
- **`startHttpServer(options)`** -- Launches the MCP server over HTTP transport

**Supervision Tools (registration helpers):**
- **`registerClassifyRisk`** -- Classifies risk tier of an agent action
- **`registerAuditCompletion`** -- Audits whether a task was completed correctly
- **`registerExpandIntent`** -- Expands a terse user intent into structured detail
- **`registerDeriveCompletion`** -- Derives completion criteria from a task description
- **`registerExplainTrace`** -- Explains an execution trace in human-readable form

**Host (Client):**
- **`McpHostManager`** -- Manages connections to external MCP servers, discovers tools, and routes `callTool` requests

## Usage

```typescript
import { createArcMcpServer, startStdioServer } from "@axiom-labs/arc-mcp";

const server = createArcMcpServer();
await startStdioServer(server);
```

```typescript
import { McpHostManager } from "@axiom-labs/arc-mcp";

const host = new McpHostManager();
await host.connect({ name: "my-server", command: "npx", args: ["-y", "my-mcp-server"] });
const tools = host.listTools();
```

## Development

```bash
cd packages/mcp
pnpm typecheck
pnpm build
```

## License

MIT
