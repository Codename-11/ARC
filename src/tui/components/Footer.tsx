import { Box, Text } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { useTheme } from "../theme.js";
import { VERSION } from "../../version.js";

interface Props {
  hasProfiles: boolean;
  activeView: string;
  focusedPane: "sidebar" | "content";
  overlayOpen: boolean;
  overlayName?: string | null;
  workspaceTyping: boolean;
}

interface KeyHintProps {
  label: string;
  desc: string;
}

function KeyHint({ label, desc }: KeyHintProps) {
  const { theme } = useTheme();
  const { colors } = theme;

  return (
    <Box gap={0}>
      <Text bold color={colors.primary}>[</Text>
      <Text bold color={colors.text}>{label}</Text>
      <Text bold color={colors.primary}>]</Text>
      <Text color={colors.dimmed}> {desc}</Text>
    </Box>
  );
}

export function Footer({
  hasProfiles,
  activeView,
  focusedPane,
  overlayOpen,
  overlayName,
  workspaceTyping,
}: Props) {
  const { width } = useScreenSize();
  const { theme } = useTheme();
  const mode =
    focusedPane === "sidebar"
      ? "nav"
      : activeView === "profiles"
        ? "profile queue"
        : "workspace";

  return (
    <Box
      width={width}
      paddingX={2}
      paddingY={0}
      justifyContent="space-between"
    >
      <Box gap={2}>
        {overlayOpen ? (
          <>
            <KeyHint label="↑↓" desc="move" />
            <KeyHint label="⏎" desc="select" />
            <KeyHint label="esc" desc="close" />
          </>
        ) : hasProfiles ? (
          <>
            <KeyHint label="↑↓" desc={mode} />
            <KeyHint label="tab" desc="focus" />
            <KeyHint label="⏎" desc={activeView === "profiles" ? "launch" : "run"} />
            {activeView === "profiles" && focusedPane === "content" && (
              <>
                <KeyHint label="s" desc="switch" />
                <KeyHint label="d" desc="delete" />
                <KeyHint label="c" desc="create" />
              </>
            )}
            {activeView === "workspace" && focusedPane === "content" && (
              <KeyHint label="/" desc="command" />
            )}
          </>
        ) : (
          <>
            <KeyHint label="tab" desc="focus" />
            <KeyHint label="c" desc="create" />
          </>
        )}
      </Box>

      <Box gap={2}>
        {overlayOpen ? (
          <KeyHint label="panel" desc={overlayName ?? "overlay"} />
        ) : workspaceTyping ? (
          <>
            <KeyHint label="enter" desc="submit" />
            <KeyHint label="esc" desc="clear" />
          </>
        ) : focusedPane === "sidebar" ? (
          <>
            <KeyHint label="ctrl+p" desc="palette" />
            <KeyHint label="?" desc="help" />
            <KeyHint label="c" desc="create" />
            <KeyHint label="q" desc="quit" />
          </>
        ) : (
          <>
            <KeyHint label="ctrl+p" desc="palette" />
            <KeyHint label="ctrl+t" desc="theme" />
            <KeyHint label="ctrl+q" desc="quit" />
          </>
        )}
        <Text color={theme.colors.dimmed}>v{VERSION}</Text>
      </Box>
    </Box>
  );
}
