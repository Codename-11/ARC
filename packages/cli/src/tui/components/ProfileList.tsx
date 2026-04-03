import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import type { ProfileEntry } from "../useProfiles.js";

interface Props {
  profiles: ProfileEntry[];
  selectedIndex: number;
  sharedSource?: string;
}

const STATUS_WIDTH = 10;

function StatusBadge({ entry }: { entry: ProfileEntry }) {
  const { theme } = useTheme();
  const { colors } = theme;

  if (entry.credError) {
    return <Box width={STATUS_WIDTH}><Text color={colors.error}>{"\u2716"} error</Text></Box>;
  }
  if (!entry.credential) {
    return <Box width={STATUS_WIDTH}><Text color={colors.dimmed}>{"\u00B7 \u00B7 \u00B7"}</Text></Box>;
  }
  if (entry.credential.expired) {
    return <Box width={STATUS_WIDTH}><Text color={colors.warning}>{"\u26A0"} expired</Text></Box>;
  }
  if (entry.credential.authenticated) {
    return <Box width={STATUS_WIDTH}><Text color={colors.success}>{"\u2714"} ready</Text></Box>;
  }
  return <Box width={STATUS_WIDTH}><Text color={colors.error}>{"\u2716"} not set</Text></Box>;
}

function ProfileRow({
  entry,
  selected,
  colWidths,
  isSyncSource,
}: {
  entry: ProfileEntry;
  selected: boolean;
  colWidths: number[];
  isSyncSource: boolean;
}) {
  const { theme } = useTheme();
  const { colors } = theme;

  const isActive = entry.active;
  const bg = selected ? colors.bgSelected : undefined;

  // Prefix: cursor(2) + dot(1) + space(1) = 4 chars
  const PREFIX_WIDTH = 4;

  return (
    <Box backgroundColor={bg} paddingX={1}>
      {/* Cursor + dot prefix */}
      <Box width={PREFIX_WIDTH} flexShrink={0}>
        <Text color={selected ? colors.primary : colors.border}>
          {selected ? "\u276F " : "  "}
        </Text>
        <Text color={isActive ? colors.accent : colors.dimmed}>
          {isActive ? "\u25CF" : "\u25CB"}
        </Text>
      </Box>

      {/* Name */}
      <Box width={colWidths[0] + 2} flexShrink={0}>
        <Text
          color={selected ? colors.text : isActive ? colors.text : colors.dimmed}
          bold={isActive || selected}
        >
          {entry.name}
        </Text>
      </Box>

      {/* Tool (always colored by tool type) */}
      <Box width={colWidths[1] + 2} flexShrink={0}>
        <Text color={
          entry.tool === "claude" ? "#4A90D9"
          : entry.tool === "gemini" ? "#34A853"
          : entry.tool === "codex" ? "#F59E0B"
          : colors.secondary
        }>
          {entry.tool}
        </Text>
      </Box>

      {/* Auth type */}
      <Box width={colWidths[2] + 2} flexShrink={0}>
        <Text color={colors.dimmed}>{entry.authType}</Text>
      </Box>

      {/* Status */}
      <StatusBadge entry={entry} />

      {/* Shared + source indicator */}
      <Box width={4} flexShrink={0}>
        {isSyncSource ? (
          <Text color={colors.primary}>{"\u2605"} </Text>
        ) : entry.sharedEnabled ? (
          <Text color={colors.dimmed}>{"\u29C9"} </Text>
        ) : (
          <Text>  </Text>
        )}
      </Box>

      {/* Launch flags */}
      <Text color={entry.launchArgs?.length ? colors.dimmed : colors.border} wrap="truncate">
        {entry.launchArgs?.length ? entry.launchArgs.join(" ") : "\u2013"}
      </Text>
    </Box>
  );
}

export function ProfileList({ profiles, selectedIndex, sharedSource }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;

  if (profiles.length === 0) {
    return (
      <Box paddingLeft={2} paddingY={1} flexDirection="column" gap={1}>
        <Text color={colors.dimmed}>No profiles yet.</Text>
        <Box gap={1}>
          <Text color={colors.dimmed}>Run</Text>
          <Text bold color={colors.primary}>arc create {"<name>"}</Text>
          <Text color={colors.dimmed}>to get started.</Text>
        </Box>
      </Box>
    );
  }

  // Compute column widths for alignment
  const colWidths = [
    Math.max(4, ...profiles.map((p) => p.name.length)),
    Math.max(4, ...profiles.map((p) => p.tool.length)),
    Math.max(4, ...profiles.map((p) => p.authType.length)),
  ];

  const PREFIX_WIDTH = 4;
  const totalWidth = PREFIX_WIDTH + (colWidths[0] + 2) + (colWidths[1] + 2) + (colWidths[2] + 2) + STATUS_WIDTH + 4;

  return (
    <Box flexDirection="column">
      {/* Column headers — matches row layout exactly */}
      <Box paddingX={1}>
        <Box width={PREFIX_WIDTH} flexShrink={0}><Text> </Text></Box>
        <Box width={colWidths[0] + 2} flexShrink={0}><Text color={colors.dimmed} bold>NAME</Text></Box>
        <Box width={colWidths[1] + 2} flexShrink={0}><Text color={colors.dimmed} bold>TOOL</Text></Box>
        <Box width={colWidths[2] + 2} flexShrink={0}><Text color={colors.dimmed} bold>AUTH</Text></Box>
        <Box width={STATUS_WIDTH} flexShrink={0}><Text color={colors.dimmed} bold>STATUS</Text></Box>
        <Box width={4} flexShrink={0}><Text color={colors.dimmed} bold>SYNC</Text></Box>
        <Text color={colors.dimmed} bold>FLAGS</Text>
      </Box>

      {/* Separator */}
      <Box paddingX={1}>
        <Text color={colors.border}>{"\u2500".repeat(totalWidth)}</Text>
      </Box>

      {profiles.map((entry, i) => (
        <ProfileRow
          key={entry.name}
          entry={entry}
          selected={i === selectedIndex}
          colWidths={colWidths}
          isSyncSource={entry.name === sharedSource}
        />
      ))}
    </Box>
  );
}
