import { Box, Text } from "ink";
import { useTheme, type ThemeColors } from "../theme.js";
import type { ProfileEntry } from "../useProfiles.js";

interface Props {
  profiles: ProfileEntry[];
}

function SectionHeader({ label, fillWidth }: { label: string; fillWidth?: number }) {
  const { theme } = useTheme();
  const fill = fillWidth ?? Math.max(2, 24 - label.length);
  return (
    <Box gap={1} marginBottom={1}>
      <Text color={theme.colors.dimmed}>{label}</Text>
      <Text color={theme.colors.border}>{"─".repeat(fill)}</Text>
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

interface TraceEntry {
  timestamp: string;
  action: string;
  session: string;
  level: TraceLevel;
}

// TODO: Wire to real activity log from src/log.ts and telemetry exporters
const PLACEHOLDER_TRACES: TraceEntry[] = [
  { timestamp: "09:32:15", action: "profile.switch", session: "ses_a1b2", level: "info" },
  { timestamp: "09:31:42", action: "shared.pull", session: "ses_a1b2", level: "info" },
  { timestamp: "09:30:08", action: "swap.capture", session: "ses_c3d4", level: "warn" },
];

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

export function TelemetryView({ profiles }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;

  // TODO: Compute from real telemetry store
  const totalTraces = PLACEHOLDER_TRACES.length;
  const activeSessions = new Set(PLACEHOLDER_TRACES.map((t) => t.session)).size;
  const exporters = 0;

  return (
    <Box flexDirection="column" gap={1}>
      <SectionHeader label="telemetry" />

      {/* Recent traces */}
      <Box flexDirection="column">
        {PLACEHOLDER_TRACES.map((trace, index) => (
          <Box key={index} gap={2} paddingLeft={1}>
            <Text color={colors.dimmed}>{trace.timestamp}</Text>
            <Box width={20}>
              <Text color={levelColor(trace.level, colors)}>{trace.action}</Text>
            </Box>
            <Text color={colors.dimmed}>{trace.session}</Text>
            <Text color={levelColor(trace.level, colors)} bold={trace.level !== "info"}>
              {trace.level}
            </Text>
          </Box>
        ))}
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
    </Box>
  );
}
