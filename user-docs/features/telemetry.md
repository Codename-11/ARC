# Telemetry

ARC includes a local-first telemetry system built on OpenTelemetry. All trace data stays on your machine — nothing is sent externally unless you configure an OTLP exporter.

## Status

```bash
arc telemetry status
```

Shows whether trace collection is enabled, the current storage size, and exporter configuration.

## Viewing Traces

```bash
arc telemetry traces
arc telemetry traces --limit 100
arc telemetry traces --session <id>
```

Traces capture command invocations, tool calls, hook evaluations, and timing information per session.

## OpenTelemetry Integration

ARC wraps OpenTelemetry with span helpers that use the `arc.*` attribute namespace. Every supervision decision produces a trace.

### Span Types

| Span | Attributes | Description |
|------|-----------|-------------|
| `arc.session` | `arc.profile`, `arc.tool` | Session lifecycle |
| `arc.preflight` | `arc.hook.name`, `arc.result` | Pre-execution hook evaluation |
| `arc.hook` | `arc.hook.name`, `arc.hook.mode` | Individual hook execution |
| `arc.agent.execution` | `arc.adapter`, `arc.model` | Agent tool invocation |
| `arc.tool.use` | `arc.tool.name`, `arc.risk.tier` | Tool call with risk classification |
| `arc.postflight` | `arc.hook.name`, `arc.result` | Post-execution hook evaluation |
| `arc.circuit_breaker` | `arc.cb.state`, `arc.cb.failures` | Circuit breaker state change |

### Attribute Namespace

All ARC spans use the `arc.*` namespace to avoid conflicts with other OpenTelemetry instrumentation:

- `arc.profile` — active profile name
- `arc.tool` — agent tool being supervised
- `arc.adapter` — adapter name (claude-code, codex, gemini, etc.)
- `arc.hook.name` — hook that produced the span
- `arc.hook.mode` — enforcement mode (log/warn/enforce/off)
- `arc.risk.tier` — risk classification result
- `arc.session.id` — session identifier

## Exporters

ARC ships with three exporters:

### Console Exporter

Writes formatted span data to stdout. Useful for development and debugging.

### JSON File Exporter

Writes spans as JSONL (one JSON object per line) to `~/.arc/traces/`. This is the default exporter.

```bash
# Trace files
~/.arc/traces/
  2026-04-01.jsonl
  2026-04-02.jsonl
```

### OTLP Exporter

Sends spans to any OpenTelemetry-compatible collector. Configure the endpoint in your profile or `arc.json`:

```json
{
  "telemetry": {
    "exporter": "otlp",
    "endpoint": "http://localhost:4318/v1/traces",
    "sampleRate": 1.0
  }
}
```

## TUI Telemetry View

The TUI Traces view (labeled "Telemetry" in the sidebar) displays real log events from `queryLogEvents()` with keyboard-driven refresh.

| Key | Action |
|-----|--------|
| `r` | Refresh the event list |

The view shows timestamped log events with level, component, and message. Events update on refresh, giving you a live tail of structured log output directly in the TUI.

## Structured Logs

Separate from OpenTelemetry traces, ARC also writes structured logs:

```bash
arc logs
arc logs --level error --limit 20
arc logs --component hooks
arc logs --profile work
arc logs --json
```

Logs are stored in `~/.arc/logs/structured.jsonl` with level, component, profile, and timestamp fields.

## Web Dashboard

The dashboard exposes traces via the `/api/traces` endpoint. The Traces view provides a filterable trace inspector with timing waterfall visualization.
