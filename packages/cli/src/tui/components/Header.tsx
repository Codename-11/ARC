import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import { VERSION } from "../../version.js";

export function Header() {
  const { theme } = useTheme();
  const { colors } = theme;

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={colors.dimmed}>[</Text>
        <Text color={colors.primary} bold>{">"}</Text>
        <Text color={colors.dimmed}>]</Text>
        <Text bold color={colors.primary}> ARC</Text>
        <Text color={colors.dimmed}>v{VERSION}</Text>
        <Text color={colors.dimmed}>— Agent Runtime Control</Text>
      </Box>
      <Text color={colors.border}>
        {"─".repeat(48)}
      </Text>
    </Box>
  );
}
