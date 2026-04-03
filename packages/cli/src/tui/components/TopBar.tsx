import { Box, Text } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { useTheme } from "../theme.js";
import type { ProfileEntry } from "../useProfiles.js";
import { VERSION } from "../../version.js";

interface Props {
  activeView: string;
  profiles: ProfileEntry[];
}

export function TopBar({ activeView, profiles }: Props) {
  const { theme, isDark } = useTheme();
  const { colors } = theme;
  const { width } = useScreenSize();
  const activeProfile = profiles.find((profile) => profile.active);
  const readyCount = profiles.filter((profile) => profile.credential?.authenticated).length;

  return (
    <Box
      width={width}
      justifyContent="space-between"
      paddingX={1}
      paddingY={0}
    >
      <Box gap={1} alignItems="center">
        <Text color={colors.dimmed}>[</Text>
        <Text color={colors.primary} bold>{">"}</Text>
        <Text color={colors.dimmed}>]</Text>
        <Text bold color={colors.primary}>ARC</Text>
        <Text color={colors.dimmed}>v{VERSION}</Text>
        <Text color={colors.border}>│</Text>
        <Text color={colors.dimmed}>
          {activeProfile ? activeProfile.name : "—"}
        </Text>
        <Text color={colors.border}>·</Text>
        <Text color={colors.dimmed}>
          {readyCount}/{profiles.length} ready
        </Text>
      </Box>

      <Box gap={1} alignItems="center">
        <Text color={colors.dimmed}>{activeView}</Text>
        <Text color={colors.border}>│</Text>
        <Text color={isDark ? colors.text : colors.dimmed}>
          {isDark ? "◐ carbon" : "○ photon"}
        </Text>
      </Box>
    </Box>
  );
}
