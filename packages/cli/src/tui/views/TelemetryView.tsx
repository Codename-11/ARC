import { useEffect, useState, useRef, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme, type ThemeColors } from "../theme.js";
import { useTelemetry } from "../useTelemetry.js";
import type { ProfileEntry } from "../useProfiles.js";

interface Props {
  profiles: ProfileEntry[];
  focusedPane: "sidebar" | "content";
  inputEnabled: boolean;
}

function SectionHeader({ label, fillWidth }: { label: string; fillWidth?: number }) {
  const { theme } = useTheme();
  const fill = fillWidth ?? Math.max(2, 24 - label.length);
  return (
    <Box gap={1} marginBottom={1}>
      <Text color={theme.colors.dimmed}>{label}</Text>
      <Text color={theme.colors.border}>{"\u2500".repeat(fill)}</Text>
    </Box>
  );
}

function StatusRow({ label, value, color }: { label: string; value: string; color?: string }) {
  const { theme } = useTheme();
  return (
    <Box gap={1}>
      <Box width={18}>
        <Text color={theme.colors.dimmed}>{label}</Text>
      </Box>
      <Text color={color ?? theme.colors.text}>{value}</Text>
    </Box>
  );
}

type TraceLevel = "info" | "warn" | "error";

function levelColor(level: TraceLevel, colors: ThemeColors): string {
  switch (level) {
    case "info":
      return colors.text;
    case "warn":
      return colors.warning;
    case "error":
      return colors.error;
  }
}

const MAX_VISIBLE = 20;

export function TelemetryView({ profiles, focusedPane, inputEnabled }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const isActive = focusedPane === "content";
  const { events, reload } = useTelemetry();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  // --- Fix #3: Safe message timeout ---
  const messageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showMessage = useCallback((text: string) => {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setMessage(text);
    messageTimer.current = setTimeout(() => setMessage(null), 2500);
  }, []);
  useEffect(() => () => { if (messageTimer.current) clearTimeout(messageTimer.current); }, []);

  const displayEvents = events;

  // --- Fix #4: Clamp selectedIndex when events change ---
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, displayEvents.length - 1)));
  }, [displayEvents.length]);

  useInput(
    (input, key) => {
      if (!isActive || !inputEnabled) return;

      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }

      // --- Fix #8: Cap navigation at visible range ---
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, Math.min(displayEvents.length - 1, MAX_VISIBLE - 1)));
        return;
      }

      if (input === "r") {
        reload();
        showMessage("Refreshing traces...");
        return;
      }
    },
    { isActive: isActive && inputEnabled },
  );

  // TODO: Compute from real telemetry store
  const totalTraces = displayEvents.length;
  const activeSessions = new Set(displayEvents.map((t) => t.session)).size;
  const exporters = 0;

  return (
    <Box flexDirection="column" gap={1}>
      <SectionHeader label="telemetry" />

      {/* Recent traces */}
      <Box flexDirection="column">
        {displayEvents.length === 0 ? (
          <Box paddingLeft={1}>
            <Text color={colors.dimmed}>No traces recorded yet.</Text>
          </Box>
        ) : (
          displayEvents.slice(0, MAX_VISIBLE).map((trace, index) => {
            const isSelected = index === selectedIndex;
            return (
              <Box
                key={index}
                gap={2}
                paddingLeft={1}
                backgroundColor={isSelected ? colors.bgSelected : undefined}
              >
                <Text color={colors.dimmed}>{trace.timestamp}</Text>
                <Box width={20}>
                  <Text color={levelColor(trace.level, colors)}>{trace.action}</Text>
                </Box>
                <Text color={colors.dimmed}>{trace.session}</Text>
                <Text color={levelColor(trace.level, colors)} bold={trace.level !== "info"}>
                  {trace.level}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      {/* Summary */}
      <Box flexDirection="column" marginTop={1}>
        <SectionHeader label="summary" />
        <Box flexDirection="column" paddingLeft={1}>
          <StatusRow label="total traces" value={String(totalTraces)} />
          <StatusRow label="active sessions" value={String(activeSessions)} />
          <StatusRow
            label="exporters"
            value={exporters > 0 ? String(exporters) : "none"}
            color={exporters > 0 ? colors.success : colors.dimmed}
          />
        </Box>
      </Box>

      {/* Message bar */}
      {message && (
        <Box paddingLeft={1} paddingTop={1}>
          <Text color={colors.warning}>{message}</Text>
        </Box>
      )}

      {/* Key hints */}
      <Box paddingLeft={1} paddingTop={1} gap={2}>
        <Text color={colors.dimmed}>
          <Text color={colors.primary} bold>[r]</Text> refresh{"  "}
          <Text color={colors.primary} bold>[esc]</Text> back
        </Text>
      </Box>
    </Box>
  );
}
