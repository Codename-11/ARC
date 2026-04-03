/**
 * arc telemetry — CLI commands for trace/span inspection.
 *
 * Subcommands: traces, status
 */
import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import { getArcDir } from "../../packages/core/src/paths.js";
import type { Span, SpanStatus } from "../../packages/core/src/telemetry/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tracesPath(): string {
  return path.join(getArcDir(), "traces", "traces.jsonl");
}

function loadSpans(limit: number, sessionId?: string): Span[] {
  const filePath = tracesPath();
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);

  let spans: Span[] = [];
  for (const line of lines) {
    try {
      const span = JSON.parse(line) as Span;
      spans.push(span);
    } catch {
      // Skip malformed lines
    }
  }

  if (sessionId) {
    spans = spans.filter(
      (s) => s.attributes["arc.session_id"] === sessionId || s.traceId === sessionId,
    );
  }

  // Return most recent first, limited
  return spans.reverse().slice(0, limit);
}

const STATUS_COLOR: Record<SpanStatus, (s: string) => string> = {
  ok: pc.green,
  error: pc.red,
  unset: pc.dim,
};

function formatSpanStatus(status: SpanStatus): string {
  const color = STATUS_COLOR[status] ?? pc.white;
  return color(status);
}

function spanDuration(span: Span): string {
  if (!span.endTime) return pc.dim("...");
  const start = new Date(span.startTime).getTime();
  const end = new Date(span.endTime).getTime();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleTelemetryTraces(opts: {
  limit?: string | number;
  session?: string;
  json?: boolean;
}): Promise<void> {
  const limit = typeof opts.limit === "string" ? Number.parseInt(opts.limit, 10) : (opts.limit ?? 50);
  const spans = loadSpans(Number.isFinite(limit) ? limit : 50, opts.session);

  if (opts.json) {
    process.stdout.write(JSON.stringify(spans, null, 2) + "\n");
    return;
  }

  if (spans.length === 0) {
    process.stdout.write(pc.dim("No trace spans found.\n"));
    const fp = tracesPath();
    if (!fs.existsSync(fp)) {
      process.stdout.write(pc.dim(`  Trace file: ${fp} (not found)\n`));
    }
    return;
  }

  const idW = 10;
  const nameW = Math.max(6, ...spans.map((s) => s.name.length)) + 2;
  const statusW = 8;
  const durW = 8;
  const agoW = 10;

  process.stdout.write(
    `  ${"Span".padEnd(idW)}${pc.dim("│")} ${"Name".padEnd(nameW)}${pc.dim("│")} ${"Status".padEnd(statusW)}${pc.dim("│")} ${"Duration".padEnd(durW)}${pc.dim("│")} When\n`,
  );
  process.stdout.write(
    pc.dim(`  ${"─".repeat(idW)}┼${"─".repeat(nameW + 1)}┼${"─".repeat(statusW + 1)}┼${"─".repeat(durW + 1)}┼${"─".repeat(agoW)}`) + "\n",
  );

  for (const span of spans) {
    const id = pc.dim(span.id.slice(0, 8));
    const name = span.name;
    const status = formatSpanStatus(span.status);
    const dur = spanDuration(span);
    const ago = pc.dim(relativeTime(span.startTime));

    process.stdout.write(
      `  ${id.padEnd(idW + 10)}${pc.dim("│")} ${name.padEnd(nameW)}${pc.dim("│")} ${status.padEnd(statusW + 10)}${pc.dim("│")} ${dur.padEnd(durW)}${pc.dim("│")} ${ago}\n`,
    );
  }

  process.stdout.write(pc.dim(`\n  ${spans.length} span(s) shown.\n`));
}

export async function handleTelemetryStatus(opts: {
  json?: boolean;
}): Promise<void> {
  const fp = tracesPath();
  const exists = fs.existsSync(fp);
  let spanCount = 0;
  let fileSize = 0;

  if (exists) {
    const stat = fs.statSync(fp);
    fileSize = stat.size;
    const raw = fs.readFileSync(fp, "utf-8");
    spanCount = raw.split("\n").filter((l) => l.trim().length > 0).length;
  }

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({
        tracesFile: fp,
        exists,
        spanCount,
        fileSize,
      }, null, 2) + "\n",
    );
    return;
  }

  process.stdout.write(pc.bold("Telemetry Status") + "\n\n");
  process.stdout.write(`  Traces file: ${pc.dim(fp)}\n`);
  process.stdout.write(`  Exists:      ${exists ? pc.green("yes") : pc.dim("no")}\n`);
  process.stdout.write(`  Spans:       ${pc.bold(String(spanCount))}\n`);
  if (exists) {
    const sizeStr = fileSize < 1024
      ? `${fileSize} B`
      : fileSize < 1024 * 1024
        ? `${(fileSize / 1024).toFixed(1)} KB`
        : `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
    process.stdout.write(`  File size:   ${pc.dim(sizeStr)}\n`);
  }
}
