# Tasks

Track work items across profiles with a lightweight task management system built into ARC. Tasks can be assigned to specific profiles, filtered by status, and scheduled with cron expressions.

## Creating Tasks

```bash
arc tasks create "Implement login page"
arc tasks create "Implement login page" --priority high --assignee work
arc tasks create "Run nightly tests" --priority medium
```

## Listing and Filtering

```bash
arc tasks list
arc tasks list --status working
arc tasks list --status pending --priority high
arc tasks list --assignee work
```

## Updating Tasks

```bash
arc tasks update <id> --status working
arc tasks update <id> --status completed
arc tasks update <id> --priority critical
arc tasks stop <id>
```

## Task Properties

| Property | Values | Default |
|----------|--------|---------|
| **Status** | `pending`, `working`, `completed`, `blocked` | `pending` |
| **Priority** | `low`, `medium`, `high`, `critical` | `medium` |
| **Assignee** | Any profile name | unassigned |

Tasks assigned to a profile are displayed in that profile's detail view in the TUI.

## Cron Scheduling

Schedule tasks to run on a recurring basis using standard 5-field cron expressions.

```bash
# Every day at 2 AM
arc tasks cron create "Nightly lint check" --schedule "0 2 * * *"

# Every Monday at 9 AM
arc tasks cron create "Weekly review" --schedule "0 9 * * 1"

arc tasks cron list
arc tasks cron delete <id>
```

The cron store persists schedules in `~/.arc/tasks/tasks.json` alongside regular tasks.

## Agent-to-Agent Messaging

The task system includes an in-memory message bus for inter-agent communication. Agents can send structured messages to each other via the `MessageBus`:

```typescript
// Subscribe to messages
messageBus.subscribe('worker-1', (msg) => {
  console.log(`Received: ${msg.content}`);
});

// Send a message
messageBus.send({
  from: 'coordinator',
  to: 'worker-1',
  content: 'Start task #42',
});
```

This enables coordination patterns in multi-agent setups, particularly in [Dark Factory](/features/factory) mode.

## Storage

Tasks are stored in `~/.arc/tasks/tasks.json` as a flat JSON array. Each task has a unique ID, creation timestamp, and update timestamp.

The web dashboard exposes tasks via the `/api/tasks` REST endpoint, and task changes are pushed in real-time over WebSocket.
