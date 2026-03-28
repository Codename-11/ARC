import { Box, Text } from "ink";
import { useTheme } from "../theme.js";

export function StepHint({ keys }: { keys: { label: string; desc: string }[] }) {
  const { theme } = useTheme();
  return (
    <Box gap={2} marginTop={1}>
      {keys.map((k) => (
        <Box key={k.label} gap={0}>
          <Text color={theme.colors.primary} bold>[{k.label}]</Text>
          <Text color={theme.colors.dimmed}> {k.desc}</Text>
        </Box>
      ))}
    </Box>
  );
}
