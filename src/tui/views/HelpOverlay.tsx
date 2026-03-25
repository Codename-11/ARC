import { Box, Text } from "ink";
import { Overlay } from "../components/Overlay.js";
import { useTheme } from "../theme.js";

export function HelpOverlay() {
  const { theme } = useTheme();
  const { colors } = theme;

  return (
    <Overlay
      title="Workspace Help"
      subtitle="ARC now behaves like a shell-first workspace. Esc closes this panel."
    >
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text color={colors.primary} bold>
            Global
          </Text>
          <Text color={colors.text}>Tab switches sidebar and content focus.</Text>
          <Text color={colors.text}>Ctrl+P opens the command palette.</Text>
          <Text color={colors.text}>? opens this help panel when you are not typing.</Text>
        </Box>
        <Box flexDirection="column">
          <Text color={colors.primary} bold>
            Workspace
          </Text>
          <Text color={colors.text}>Use arrow keys to move through the launch queue.</Text>
          <Text color={colors.text}>Press Enter with an empty composer to launch the selected profile.</Text>
          <Text color={colors.text}>Type slash commands like /launch, /switch, /doctor, /profiles, or /help.</Text>
        </Box>
        <Box flexDirection="column">
          <Text color={colors.primary} bold>
            Profiles
          </Text>
          <Text color={colors.text}>Enter launches the selected profile.</Text>
          <Text color={colors.text}>s switches the active profile and d deletes it.</Text>
        </Box>
      </Box>
    </Overlay>
  );
}
