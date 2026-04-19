# @axiom-labs/arc-relay

Self-hosted, end-to-end-encrypted tunnel for remote ARC daemon access.

**Status:** placeholder. Implementation lands in Phase 10 of the v3 plan
(see `docs/plans/arc-v3-daemon.md`). The relay is a stateless WebSocket
multiplexer that routes opaque NaCl-box-encrypted frames between a daemon
and its paired clients.
