# Expansion Ideas

ARC has completed all 25 phases of the v2.0 spec — multi-tool adapters, encrypted secrets, task management, memory system, skill registry, session continuity, web dashboard, telemetry, remote agents, plugins, cloud sync, and dark factory orchestration are all implemented.

This document tracks what comes next.

## v2 Deferred Items

These items were scoped during v2 planning but deferred for follow-up work:

- **A2A Protocol** — Agent-to-agent communication protocol for cross-tool coordination
- **Prompt Routing** — Intelligent routing of prompts to the best-fit agent based on task type, model strength, and cost
- **Agent Personas** — Configurable personality/behavior presets per profile (tone, verbosity, tool preferences)
- **S3 Sync Backend** — Cloud sync via S3-compatible storage as an alternative to the current sync provider

## Future Ideas

- **SQLite migration** — Replace JSON file stores (config, memories, tasks, sessions) with SQLite for better query performance and concurrent access
- **Embedding-based memory search** — Use local or remote embeddings for semantic memory retrieval instead of keyword matching
- **CI/CD integration** — GitHub Actions / GitLab CI helpers for running ARC profiles in pipelines (auth injection, profile selection, artifact collection)
- **Team collaboration** — Shared profile templates, org-level plugin registries, and team sync with conflict resolution
- **TUI enhancements** — Setup/update/uninstall flows inside the TUI, statusline management, search/filter for large profile lists
