import { Box, Text } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { useTheme } from "../theme.js";
import type { ProfileEntry } from "../useProfiles.js";

const VERSION = "2.0.0";

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
      paddingX={2}
      paddingY={0}
    >
      <Box gap={1} alignItems="center">
        <Text color={colors.secondary} bold>◆</Text>
        <Text bold color={colors.primary}>ARC</Text>
        <Text color={colors.dimmed}>v{VERSION}</Text>
        <Text color={colors.border}>│</Text>
        <Text color={colors.dimmed}>
          {activeProfile ? `${activeProfile.name} · ${activeProfile.tool}` : "no active profile"}
        </Text>
        <Text color={colors.border}>│</Text>
        <Text color={colors.dimmed}>
          {readyCount}/{profiles.length} ready
        </Text>
      </Box>

      <Box gap={1} alignItems="center">
        <Text color={colors.dimmed}>{activeView}</Text>
        <Text color={colors.border}>│</Text>
        <Text color={colors.dimmed}>
          {isDark ? "◐" : "○"}
        </Text>
        <Text color={isDark ? colors.text : colors.dimmed}>
          {isDark ? "dark" : "light"}
        </Text>
        <Text color={colors.border}>│</Text>
        <Text color={colors.dimmed}>t</Text>
        <Text color={colors.dimmed}> toggle</Text>
      </Box>
    </Box>
  );
}
