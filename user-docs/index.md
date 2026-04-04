---
layout: home
hero:
  name: ARC
  text: Agent Runtime Control
  tagline: One binary. One config directory. Every AI coding agent — profiles, supervision, hooks, memory, tasks, telemetry, and a web dashboard.
  image:
    src: /arc-hero.svg
    alt: ARC — Agent Runtime Control
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/Codename-11/ARC

features:
  - title: Profiles & Identity
    details: Named profiles with isolated credentials, settings, and environments. OAuth, API key, Bedrock, Vertex, Foundry auth. OS keyring storage.
  - title: Multi-Runtime Adapters
    details: Claude Code (SDK + hooks + plugins), Codex CLI, Gemini CLI, OpenClaw, and a generic adapter for anything that speaks MCP or HTTP.
  - title: Supervision Pipeline
    details: Four-mode hook enforcement (log/warn/enforce/off), risk classification, preflight/postflight hooks, retry loops, and circuit breaker.
  - title: Memory & Skills
    details: Persistent memory with exponential decay scoring. Directory-based skills, MCP-to-skill adapters, self-improving skillify, and stuck detection.
  - title: Tasks & Sessions
    details: Task CRUD with cron scheduling and agent-to-agent messaging. Session suspend/resume lifecycle with automatic resume-intent detection.
  - title: Web Dashboard
    details: REST API, WebSocket real-time push, and a Nothing-designed SPA with 9 view components for deep observability into agent operations.
---
