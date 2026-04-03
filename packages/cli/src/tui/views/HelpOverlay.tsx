import { Box, Text } from "ink";
import { Overlay } from "../components/Overlay.js";
import { useTheme } from "../theme.js";

function KeyHint({ label, description, width = 10 }: { label: string; description: string; width?: number }) {
  const { theme } = useTheme();
  const { colors } = theme;

  return (
    <Box>
      <Box width={width} flexShrink={0}>
        <Text color={colors.primary} bold>{label}</Text>
      </Box>
      <Text color={colors.text} wrap="truncate">{description}</Text>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  const { colors } = theme;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={colors.secondary} bold underline>{title}</Text>
      </Box>
      {children}
    </Box>
  );
}

export function HelpOverlay() {
  const { theme } = useTheme();
  const { colors } = theme;

  return (
    <Overlay
      title="Help"
      subtitle="Keyboard shortcuts and commands. Press Esc to close."
    >
      <Box gap={3}>
        {/* Left column: Global + Sidebar + Profiles */}
        <Box flexDirection="column" gap={1} flexBasis={0} flexGrow={1}>
          <Section title="Global">
            <KeyHint label="tab" description="Focus sidebar / content" />
            <KeyHint label="ctrl+p" description="Command palette" />
            <KeyHint label="ctrl+t" description="Toggle theme" />
            <KeyHint label="ctrl+q" description="Quit" />
          </Section>

          <Section title="Sidebar">
            <KeyHint label="?" description="This help panel" />
            <KeyHint label="t" description="Toggle theme" />
            <KeyHint label="c" description="Create profile" />
            <KeyHint label="u" description="Check for updates" />
            <KeyHint label="q" description="Quit" />
          </Section>

          <Section title="Profiles">
            <KeyHint label="enter" description="Launch profile" />
            <KeyHint label="s" description="Switch active" />
            <KeyHint label="d" description="Delete profile" />
            <KeyHint label="h" description="Toggle shared layer" />
            <KeyHint label="shift+h" description="Push to shared" />
            <KeyHint label="c" description="Create profile" />
          </Section>
        </Box>

        {/* Right column: Workspace commands */}
        <Box flexDirection="column" gap={1} flexBasis={0} flexGrow={1}>
          <Section title="Workspace">
            <KeyHint label="arrows" description="Navigate launch queue" />
            <KeyHint label="enter" description="Launch selected profile" />
            <Text color={colors.dimmed} wrap="truncate">Shell commands run directly</Text>
          </Section>

          <Section title="Slash Commands">
            <KeyHint label="/launch" description="Launch a profile" />
            <KeyHint label="/switch" description="Switch active profile" />
            <KeyHint label="/create" description="Create profile" />
            <KeyHint label="/dash" description="Dashboard view" />
            <KeyHint label="/profiles" description="Profiles view" />
            <KeyHint label="/settings" description="Settings view" />
            <KeyHint label="/doctor" description="Run diagnostics" />
            <KeyHint label="/clear" description="Clear workspace" />
          </Section>

          <Box>
            <Text color={colors.dimmed}>github.com/Codename-11/ARC</Text>
          </Box>
        </Box>
      </Box>
    </Overlay>
  );
}
