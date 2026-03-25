import { type ReactNode } from "react";
import { Box, Text } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { useTheme } from "../theme.js";
import { TopBar } from "./TopBar.js";
import { Footer } from "./Footer.js";
import type { ProfileEntry } from "../useProfiles.js";

interface LayoutProps {
  sidebar: ReactNode;
  content: ReactNode;
  overlay?: ReactNode;
  hasProfiles: boolean;
  activeView: string;
  focusedPane: "sidebar" | "content";
  profiles: ProfileEntry[];
  overlayOpen: boolean;
  overlayName?: string | null;
  workspaceTyping: boolean;
}

const SIDEBAR_WIDTH = 24;

// Map view name to a display label
const VIEW_LABELS: Record<string, string> = {
  workspace: "Workspace",
  profiles: "Profiles",
  settings: "Settings",
  doctor: "Doctor",
};

export function Layout({
  sidebar,
  content,
  overlay,
  hasProfiles,
  activeView,
  focusedPane,
  profiles,
  overlayOpen,
  overlayName,
  workspaceTyping,
}: LayoutProps) {
  const { width, height } = useScreenSize();
  const { theme } = useTheme();
  const { colors } = theme;

  const viewLabel = VIEW_LABELS[activeView] ?? activeView;

  return (
    // Root fill — backgroundColor paints the terminal canvas dark
    <Box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={colors.bg}
      >
      <Box backgroundColor={colors.bgPanel}>
        <TopBar activeView={viewLabel.toLowerCase()} profiles={profiles} />
      </Box>

      <Box>
        <Text color={colors.border}>{"─".repeat(Math.max(0, width))}</Text>
      </Box>

      <Box flexGrow={1} height={Math.max(1, height - 4)}>
        <Box
          flexDirection="column"
          width={SIDEBAR_WIDTH}
          borderStyle="single"
          borderColor={focusedPane === "sidebar" ? colors.borderFocused : colors.border}
          backgroundColor={colors.bgPanel}
        >
          {sidebar}
        </Box>

        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="single"
          borderColor={focusedPane === "content" ? colors.borderFocused : colors.border}
          backgroundColor={colors.bgPanel}
          paddingX={2}
          paddingY={1}
        >
          <Box justifyContent="space-between" marginBottom={1}>
            <Box gap={2}>
              <Text bold color={colors.primary}>
                {viewLabel}
              </Text>
              <Text color={colors.border}>
                {"─".repeat(Math.max(0, width - SIDEBAR_WIDTH - 24))}
              </Text>
            </Box>
            <Text color={colors.dimmed}>
              {focusedPane === "sidebar" ? "nav focus" : "content focus"}
            </Text>
          </Box>

          <Box marginBottom={1}>
            <Text color={colors.dimmed}>
              {activeView === "workspace"
                ? "Workspace shell centered on launch flow and profile state."
                : activeView === "profiles"
                  ? "Manage the profile queue and launch targets."
                  : activeView === "doctor"
                    ? "Run health checks across configured tools."
                    : "Inspect config and shell behavior."}
            </Text>
          </Box>

          <Box flexDirection="column" flexGrow={1}>
            {content}
          </Box>
        </Box>
      </Box>

      <Box>
        <Text color={colors.border}>{"─".repeat(Math.max(0, width))}</Text>
      </Box>

      {overlay ? (
        <Box paddingY={1} justifyContent="center">
          {overlay}
        </Box>
      ) : null}

      <Box backgroundColor={colors.bgPanel}>
        <Footer
          hasProfiles={hasProfiles}
          activeView={activeView}
          focusedPane={focusedPane}
          overlayOpen={overlayOpen}
          overlayName={overlayName}
          workspaceTyping={workspaceTyping}
        />
      </Box>
    </Box>
  );
}
