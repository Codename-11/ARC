# MCP Protocol

ARC plays a dual role in the MCP (Model Context Protocol) ecosystem — it acts as both an MCP **host** (connecting to external tool servers) and an MCP **server** (exposing ARC supervision as tools that agents can call).

## MCP Server

ARC exposes 5 supervision tools via MCP, allowing connected agents to access ARC's risk classification, intent expansion, and completion auditing directly.

### Starting the Server

```bash
# stdio transport (default — for piping to agent tools)
arc mcp serve

# HTTP transport (for network access)
arc mcp serve --transport http --port 3100

# With authentication
arc mcp serve --transport http --require-auth --auth-token <token>
```

### Exposed Tools

| Tool | Description |
|------|-------------|
| `expand-intent` | Expand a user intent into structured sub-tasks |
| `classify-risk` | Classify the risk tier of a proposed operation |
| `derive-completion` | Derive completion criteria from a task description |
| `audit-completion` | Audit whether completion criteria are met |
| `explain-trace` | Explain a supervision trace in human-readable form |

### Connecting an Agent

When ARC starts as an MCP server, any MCP-compatible agent can connect to it. For Claude Code, add ARC as an MCP server in the profile's `settings.json`:

```json
{
  "mcpServers": {
    "arc-supervision": {
      "command": "arc",
      "args": ["mcp", "serve"]
    }
  }
}
```

The agent can then call ARC's supervision tools directly within its workflow.

## MCP Host

ARC can connect to external MCP servers, making their tools available to the supervised agent.

### Connecting to Servers

```bash
arc mcp connect <uri>          # Connect to an MCP server
arc mcp list                   # List connected servers
arc mcp disconnect <name>      # Disconnect from a server
```

### Host Manager

The `McpHostManager` manages MCP server connections per profile:

```typescript
const host = new McpHostManager(profile);

// Connect to a server
await host.connect('my-server', { uri: 'stdio://path/to/server' });

// List available tools across all connected servers
const tools = await host.getTools();

// Call a tool with risk classification
const result = await host.callTool('my-server', 'tool-name', args);
// ARC automatically classifies the risk tier of the tool call
```

### Transports

The MCP host supports multiple transports:

| Transport | URI Scheme | Use Case |
|-----------|-----------|----------|
| stdio | `stdio://` | Local process-based servers |
| HTTP | `http://` / `https://` | Network-accessible servers |
| SSE | `sse://` | Server-sent events |
| WebSocket | `ws://` / `wss://` | Full-duplex communication |

### Tool Risk Classification

When tools are called through the MCP host, ARC automatically classifies the risk tier using the same 5-tier system as the [hook pipeline](/architecture/hooks). High-risk tool calls can be flagged or blocked depending on the enforcement mode.

## Per-Profile MCP Configuration

Each profile can have its own set of MCP server connections. The shared layer can sync MCP server configurations across profiles:

```bash
# Add an MCP server to the shared layer
# (edit ~/.arc/shared/settings.json)

# Sync to all enabled profiles
arc shared sync
```

Shared MCP servers are merged into each profile's `settings.json`. Profile-specific servers take precedence on key conflicts.

## HTTP Transport Details

When using `--transport http`, the MCP server runs an HTTP server with:

- **Per-session authentication** — each request must include the auth token
- **JSON-RPC over HTTP** — standard MCP message format
- **CORS support** — configurable for web-based clients

```bash
arc mcp serve --transport http --port 3100 --require-auth --auth-token my-secret
```

Clients connect with:

```bash
curl -X POST http://localhost:3100/mcp \
  -H "Authorization: Bearer my-secret" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"classify-risk","arguments":{"operation":"rm -rf /"}}}'
```
