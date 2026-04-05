import { useState, useEffect, useCallback } from "react";
import type { Span } from "@axiom-labs/arc-core";

export interface TelemetryEvent {
  timestamp: string;
  action: string;
  session: string;
  level: "info" | "warn" | "error";
}

export interface UseTelemetryResult {
  events: TelemetryEvent[];
  loading: boolean;
  reload: () => void;
}

/**
 * Provides telemetry trace events for the TUI.
 *
 * Currently reads from a placeholder list; will be wired to the
 * TelemetryProvider / JSON exporter in a future phase.
 */
export function useTelemetry(): UseTelemetryResult {
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    // TODO: Wire to TelemetryProvider / JSON file exporter
    // For now return empty — real traces will appear once the
    // telemetry pipeline flushes to the events store.
    setEvents([]);
    setLoading(false);
  }, [tick]);

  return { events, loading, reload };
}
