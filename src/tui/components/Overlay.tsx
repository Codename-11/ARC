import type { ReactNode } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function Overlay({ title, subtitle, children }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;

  return (
    <Box
      flexDirection="column"
      alignSelf="center"
      width={72}
      borderStyle="round"
      borderColor={colors.borderFocused}
      backgroundColor={colors.bgPanel}
      paddingX={2}
      paddingY={1}
    >
      <Text color={colors.secondary} bold>
        {title}
      </Text>
      {subtitle ? <Text color={colors.dimmed}>{subtitle}</Text> : null}
      <Box marginTop={1} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}
