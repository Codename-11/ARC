import fs from "node:fs";
import path from "node:path";
import { getStructuredLogPath } from "./paths.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEvent {
  timestamp: string;
  level: LogLevel;
  component: string;
  action: string;
  message?: string;
  detail?: string;
  profile?: string;
  tool?: string;
  data?: Record<string, unknown>;
}

export interface LogQuery {
  limit?: number;
  level?: LogLevel;
  component?: string;
  profile?: string;
}

const DEFAULT_RETENTION_LINES = 2000;
const DEFAULT_LIMIT = 50;

function ensureLogDir(): void {
  fs.mkdirSync(path.dirname(getStructuredLogPath()), { recursive: true });
}

function trimLogFile(retentionLines = DEFAULT_RETENTION_LINES): void {
  try {
    const lines = fs.readFileSync(getStructuredLogPath(), "utf-8").split(/\r?\n/).filter(Boolean);
    if (lines.length > retentionLines + 100) {
      fs.writeFileSync(
        getStructuredLogPath(),
        lines.slice(-retentionLines).join("\n") + "\n",
        "utf-8"
      );
    }
  } catch {
    // Non-fatal.
  }
}

export function writeLogEvent(
  event: Omit<LogEvent, "timestamp" | "action"> & {
    timestamp?: string;
    action?: string;
    event?: string;
  }
): void {
  try {
    ensureLogDir();
    const entry: LogEvent = {
      timestamp: event.timestamp ?? new Date().toISOString(),
      level: event.level,
      component: event.component,
      action: event.action ?? event.event ?? "activity",
      message: event.message,
      detail: event.detail ?? event.message,
      profile: event.profile,
      tool: event.tool,
      data: event.data,
    };
    fs.appendFileSync(getStructuredLogPath(), JSON.stringify(entry) + "\n", "utf-8");
    trimLogFile();
  } catch {
    // Logging must never crash ARC.
  }
}

export function logEvent(
  event: Omit<LogEvent, "timestamp" | "action"> & {
    action?: string;
    event?: string;
    timestamp?: string;
  }
): void {
  writeLogEvent(event);
}

export function logAction(
  action: string,
  detail?: string,
  context: Partial<Omit<LogEvent, "timestamp" | "action" | "message" | "detail" | "level">> & {
    level?: LogLevel;
  } = {}
): void {
  writeLogEvent({
    level: context.level ?? "info",
    component: context.component ?? "activity",
    action,
    message: detail,
    detail,
    profile: context.profile,
    tool: context.tool,
    data: context.data,
  });
}

export function queryLogEvents(query: LogQuery = {}): LogEvent[] {
  try {
    const logPath = getStructuredLogPath();
    if (!fs.existsSync(logPath)) {
      return [];
    }

    const rawLines = fs.readFileSync(logPath, "utf-8").split(/\r?\n/).filter(Boolean);
    const events: LogEvent[] = [];

    for (let index = rawLines.length - 1; index >= 0; index -= 1) {
      try {
        const parsed = JSON.parse(rawLines[index]) as LogEvent;
        if (query.level && parsed.level !== query.level) continue;
        if (query.component && parsed.component !== query.component) continue;
        if (query.profile && parsed.profile !== query.profile) continue;
        events.push(parsed);
        if (events.length >= (query.limit ?? DEFAULT_LIMIT)) {
          break;
        }
      } catch {
        // Ignore malformed historical rows.
      }
    }

    return events.reverse();
  } catch {
    return [];
  }
}

export const getLogEntries = queryLogEvents;
export const readLogEvents = queryLogEvents;
