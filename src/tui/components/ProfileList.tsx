import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import type { ProfileEntry } from "../useProfiles.js";

interface Props {
  profiles: ProfileEntry[];
  selectedIndex: number;
}

function StatusBadge({ entry }: { entry: ProfileEntry }) {
  const { theme } = useTheme();
  const { colors } = theme;

  if (entry.credError) {
    return (
      <Box>
        <Text color={colors.error}>✖ </Text>
        <Text color={colors.error}>error</Text>
      </Box>
    );
  }
  if (!entry.credential) {
    return <Text color={colors.dimmed}>· · ·</Text>;
  }
  if (entry.credential.expired) {
    return (
      <Box>
        <Text color={colors.warning}>⚠ </Text>
        <Text color={colors.warning}>expired</Text>
      </Box>
    );
  }
  if (entry.credential.authenticated) {
    return (
      <Box>
        <Text color={colors.success}>✔ </Text>
        <Text color={colors.success}>ready</Text>
      </Box>
    );
  }
  return (
    <Box>
      <Text color={colors.error}>✖ </Text>
      <Text color={colors.error}>not set</Text>
    </Box>
  );
}

function ProfileRow({
  entry,
  selected,
  colWidths,
}: {
  entry: ProfileEntry;
  selected: boolean;
  colWidths: number[];
}) {
  const { theme } = useTheme();
  const { colors } = theme;

  const isActive = entry.active;
  const bg = selected ? colors.bgSelected : undefined;

  return (
    <Box gap={0} backgroundColor={bg} paddingX={1}>
      {/* Selection cursor */}
      <Text color={selected ? colors.primary : colors.border}>
        {selected ? "❯ " : "  "}
      </Text>

      {/* Active/inactive dot */}
      <Text color={isActive ? colors.accent : colors.dimmed}>
        {isActive ? "●" : "○"}
      </Text>
      <Text>{" "}</Text>

      {/* Name */}
      <Box width={colWidths[0] + 2}>
        <Text
          color={selected ? colors.text : isActive ? colors.text : colors.dimmed}
          bold={isActive || selected}
        >
          {entry.name}
        </Text>
      </Box>

      {/* Tool */}
      <Box width={colWidths[1] + 2}>
        <Text color={selected ? colors.secondary : colors.dimmed}>
          {entry.tool}
        </Text>
      </Box>

      {/* Auth type */}
      <Box width={colWidths[2] + 2}>
        <Text color={colors.dimmed}>
          {entry.authType}
        </Text>
      </Box>

      {/* Status */}
      <StatusBadge entry={entry} />
    </Box>
  );
}

export function ProfileList({ profiles, selectedIndex }: Props) {
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

  return (
    <Box flexDirection="column">
      {/* Column headers */}
      <Box gap={0} paddingX={1} marginBottom={1}>
        <Text color={colors.border}>{"  "}</Text>
        <Text color={colors.border}>{"  "}</Text>
        <Box width={colWidths[0] + 2}>
          <Text color={colors.dimmed} bold>NAME</Text>
        </Box>
        <Box width={colWidths[1] + 2}>
          <Text color={colors.dimmed} bold>TOOL</Text>
        </Box>
        <Box width={colWidths[2] + 2}>
          <Text color={colors.dimmed} bold>AUTH</Text>
        </Box>
        <Text color={colors.dimmed} bold>STATUS</Text>
      </Box>

      {/* Header underline */}
      <Box paddingX={1} marginBottom={1}>
        <Text color={colors.border}>
          {"─".repeat(6 + colWidths[0] + colWidths[1] + colWidths[2] + 18)}
        </Text>
      </Box>

      {profiles.map((entry, i) => (
        <ProfileRow
          key={entry.name}
          entry={entry}
          selected={i === selectedIndex}
          colWidths={colWidths}
        />
      ))}
    </Box>
  );
}
