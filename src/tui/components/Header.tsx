import { Box, Text } from "ink";

const VERSION = "2.0.0";

export function Header() {
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color="magenta">◆</Text>
        <Text bold color="cyan">
          ARC
        </Text>
        <Text dimColor>v{VERSION}</Text>
        <Text dimColor>— Agent Runtime Control</Text>
      </Box>
      <Text dimColor>
        {"─".repeat(48)}
      </Text>
    </Box>
  );
}
