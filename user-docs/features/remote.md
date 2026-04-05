# Remote Agents

ARC can register and monitor remote agent instances running on other machines. Remote agents are tracked by name, endpoint, and transport type, with built-in health checking.

## Registering a Remote Agent

```bash
arc remote add my-server https://agent.example.com:8080 --transport http
arc remote add build-box ssh://ci@10.0.1.50 --transport ssh --profile worker
arc remote add mcp-relay mcp://relay.local:9090 --transport mcp
```

Each agent gets a unique ID, and you can optionally bind it to an ARC profile. Remote agents can also be targets for [task delegation](/features/orchestration#task-delegation).

## Listing Remote Agents

```bash
arc remote list
arc remote list --json
```

The table displays each agent's name, endpoint, transport protocol, last-known status, and associated profile.

## Health Checks

Check the status of a specific agent or all registered agents at once:

```bash
# Check a single agent by ID
arc remote check <id>

# Check all registered agents
arc remote check
```

Health checks contact the remote endpoint and update the agent's status to `online`, `offline`, or `unknown`. The check summary shows how many agents are reachable.

## Removing a Remote Agent

```bash
arc remote remove <id>
```

## Transport Types

| Transport | Protocol | Use Case |
|-----------|----------|----------|
| `http` | HTTP/HTTPS | Web-hosted agents, REST endpoints |
| `ssh` | SSH tunnel | Build servers, CI runners |
| `mcp` | MCP protocol | MCP relay servers, tool proxies |

The default transport is `http` if not specified.

## Use Cases

### Monitoring Distributed Agents

Register all your agents across different machines and run periodic health checks to verify they are reachable:

```bash
arc remote add prod-claude https://prod.internal:8080
arc remote add staging-gemini https://staging.internal:8081 --transport http
arc remote check
```

### Profile-Bound Agents

Bind a remote agent to an ARC profile so its status appears in the profile detail view:

```bash
arc remote add ci-worker ssh://ci@build.internal --profile worker --transport ssh
```

### Dark Factory Integration

Remote agents pair with [Dark Factory](/features/factory) mode for multi-machine orchestration. Register worker agents and coordinate them through the task system.

## Storage

Remote agent registrations are stored in `~/.arc/remote/agents.json`. Status is updated in-place after each health check. The web dashboard exposes remote agents via the `/api/remote` REST endpoint.
