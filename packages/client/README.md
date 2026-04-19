# @axiom-labs/arc-client

Client SDK for the ARC daemon's binary-multiplexed WebSocket protocol.

Used by ARC's TUI, CLI, dashboard, Electron wrapper, and mobile app.
Exposes:

- `ArcClient` — connect, reconnect, auth, call/subscribe/attachTerminal
- `Envelope`, `Methods`, `Channel` — protocol schemas shared with the daemon
- `encodeFrame`, `decodeFrame`, `encodeControl`, `decodeControl` — binary mux codec

```ts
import { ArcClient } from "@axiom-labs/arc-client";

const client = new ArcClient({ url: "ws://127.0.0.1:7272", token: "…" });
await client.connect();
const health = await client.health();
const { agents } = await client.agents.list();
```

See `docs/plans/arc-v3-daemon.md` for the full protocol spec.
