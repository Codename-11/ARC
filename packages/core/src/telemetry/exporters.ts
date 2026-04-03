// ---------------------------------------------------------------------------
// Trace exporters — Console, JSON file, and OTLP stub
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { getArcDir } from "../paths.js";
import { writeLogEvent } from "../logging.js";
import type { Span, TraceExporter } from "./types.js";

// ---------------------------------------------------------------------------
// ConsoleExporter — writes spans to the structured log via writeLogEvent
// ---------------------------------------------------------------------------

export class ConsoleExporter implements TraceExporter {
  async export(spans: Span[]): Promise<void> {
    for (const span of spans) {
      writeLogEvent({
        level: span.status === "error" ? "warn" : "debug",
        component: "telemetry",
        action: "span.export",
        message: `[${span.status}] ${span.name} (${span.id.slice(0, 8)})`,
        data: {
          spanId: span.id,
          traceId: span.traceId,
          parentId: span.parentId,
          name: span.name,
          status: span.status,
          startTime: span.startTime,
          endTime: span.endTime,
          attributes: span.attributes as Record<string, unknown>,
          eventCount: span.events.length,
        },
      });
    }
  }

  async shutdown(): Promise<void> {
    // Nothing to tear down.
  }
}

// ---------------------------------------------------------------------------
// JsonFileExporter — appends spans as JSONL to ~/.arc/traces/traces.jsonl
// ---------------------------------------------------------------------------

export class JsonFileExporter implements TraceExporter {
  private readonly filePath: string;

  constructor(jsonDir?: string) {
    const dir = jsonDir ?? path.join(getArcDir(), "traces");
    this.filePath = path.join(dir, "traces.jsonl");
  }

  async export(spans: Span[]): Promise<void> {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });

      const lines = spans.map((s) => JSON.stringify(s)).join("\n") + "\n";
      fs.appendFileSync(this.filePath, lines, "utf-8");
    } catch {
      // Telemetry must never crash ARC.
      writeLogEvent({
        level: "warn",
        component: "telemetry",
        action: "jsonfile.export.error",
        message: "Failed to write spans to JSONL file",
      });
    }
  }

  async shutdown(): Promise<void> {
    // Nothing to tear down — writes are synchronous and unbuffered.
  }

  /** Return the resolved file path (useful for diagnostics). */
  getFilePath(): string {
    return this.filePath;
  }
}

// ---------------------------------------------------------------------------
// OtlpExporter — stub for future @opentelemetry/sdk-node integration
// ---------------------------------------------------------------------------

/**
 * Placeholder exporter that records the configured OTLP endpoint but does not
 * perform any network I/O.  When the `@opentelemetry/exporter-trace-otlp-*`
 * package is added as a dependency this class will be replaced with a real
 * gRPC / HTTP exporter.
 */
export class OtlpExporter implements TraceExporter {
  private readonly endpoint: string;

  constructor(endpoint: string = "http://localhost:4317") {
    this.endpoint = endpoint;
  }

  async export(spans: Span[]): Promise<void> {
    writeLogEvent({
      level: "debug",
      component: "telemetry",
      action: "otlp.export.stub",
      message: `OTLP exporter not yet wired — ${spans.length} span(s) targeting ${this.endpoint} were dropped`,
    });
  }

  async shutdown(): Promise<void> {
    // Nothing to tear down.
  }

  /** Return the configured endpoint (useful for diagnostics). */
  getEndpoint(): string {
    return this.endpoint;
  }
}
