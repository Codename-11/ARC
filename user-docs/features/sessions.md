# Sessions

Suspend and resume agent sessions without losing context. When a session is suspended, ARC snapshots the session state so you can pick it up later — even after a reboot.

## Session Lifecycle

Sessions follow a simple state machine:

```
created → active → suspended → active → completed
                       ↑                    ↓
                       └────────────────────┘
```

| Status | Description |
|--------|-------------|
| `active` | Currently running |
| `suspended` | Paused, state preserved |
| `completed` | Finished normally |

## Listing Sessions

```bash
arc sessions list
arc sessions list --status suspended
arc sessions list --status active
arc sessions show <id>
```

## Resuming Sessions

```bash
arc sessions resume          # Resume last suspended session
arc sessions resume <id>     # Resume a specific session
```

With no arguments, `arc sessions resume` picks up the most recently suspended session.

## Completing Sessions

```bash
arc sessions complete <id>
```

## Resume-Intent Detection

ARC includes a heuristic `isResumeIntent()` function that detects when a user intends to continue a previous session. Phrases like "continue where I left off", "resume", or "pick up from yesterday" trigger automatic session lookup and resume.

This works transparently — if ARC detects resume intent in the user's first message, it automatically loads the most recent suspended session for that profile.

## Web Dashboard Session Management

The [Web Dashboard](/features/dashboard) Sessions view provides session management through a browser interface:

- **Browse** — view all sessions with status, profile, timestamps, and working directory
- **Complete** — mark an active or suspended session as completed
- **Suspend** — pause an active session, preserving its state for later resume

Session status changes are broadcast over WebSocket, so all connected dashboard clients see updates in real time.

::: tip
The CLI provides the most complete session management, including resume and resume-intent detection. The Web Dashboard supports complete and suspend operations for remote monitoring workflows.
:::

## Session Data

Each session stores:

- **Session ID** — unique identifier
- **Profile** — which profile was active
- **Working directory** — the cwd when the session was created
- **Status** — current lifecycle state
- **Created/Updated timestamps** — for ordering and display
- **Conversation checkpoint** — enough state to resume context

## Storage

Sessions are stored in `~/.arc/sessions.json` as a JSON array. The web dashboard exposes sessions via the `/api/sessions` REST endpoint with complete/suspend actions, and real-time status updates pushed over WebSocket.
