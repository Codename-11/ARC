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

// Sidebar inner width (content + padding). The right border adds 1 more column.
const SIDEBAR_INNER = 20;

// Map view name to a display label
const VIEW_LABELS: Record<string, string> = {
  dash: "Dashboard",
  workspace: "Workspace",
  profiles: "Profiles",
  about: "Guide",
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

  // Overlay sizing — centered on the full terminal screen
  const isSmallOverlay = overlayName === "create" || overlayName === "updating";
  const overlayFraction = isSmallOverlay ? 0.45 : 0.7;
  const minOverlayWidth = isSmallOverlay ? 44 : 56;
  const overlayWidth = Math.min(Math.max(minOverlayWidth, Math.floor(width * overlayFraction)), width - 4);
  const overlayLeft = Math.max(0, Math.floor((width - overlayWidth) / 2));

  // Estimate overlay height per type for vertical centering
  const estimatedOverlayHeight =
    overlayName === "help" ? 24
    : overlayName === "palette" ? 14
    : overlayName === "create" ? 12
    : overlayName === "shared-detail" ? 18
    : overlayName === "profile-info" ? 16
    : 8;
  const overlayTop = Math.max(1, Math.floor((height - estimatedOverlayHeight) / 2));

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={colors.bg}
    >
      {/* Top bar */}
      <Box>
        <TopBar activeView={viewLabel.toLowerCase()} profiles={profiles} />
      </Box>
      <Box>
        <Text color={colors.border}>{"─".repeat(width)}</Text>
      </Box>

      {/* Main body */}
      <Box flexGrow={1}>
        {/* Sidebar */}
        <Box
          flexDirection="column"
          width={SIDEBAR_INNER}
          borderRight
          borderStyle="single"
          borderColor={colors.border}
          borderTop={false}
          borderBottom={false}
          borderLeft={false}
        >
          {sidebar}
        </Box>

        {/* Content */}
        <Box
          flexDirection="column"
          flexGrow={1}
          paddingX={1}
        >
          {/* View header */}
          <Box justifyContent="space-between">
            <Text bold color={colors.primary}>{viewLabel}</Text>
            <Text color={colors.dimmed}>
              {focusedPane === "sidebar" ? "nav" : "content"}
            </Text>
          </Box>

          {/* View content */}
          <Box flexDirection="column" flexGrow={1} marginTop={1}>
            {content}
          </Box>
        </Box>
      </Box>

      {/* Footer separator + footer */}
      <Box>
        <Text color={colors.border}>{"─".repeat(width)}</Text>
      </Box>
      <Box>
        <Footer
          hasProfiles={hasProfiles}
          activeView={activeView}
          focusedPane={focusedPane}
          overlayOpen={overlayOpen}
          overlayName={overlayName}
          workspaceTyping={workspaceTyping}
        />
      </Box>

      {/* Floating overlay — absolute position over content */}
      {overlay ? (
        <Box
          position="absolute"
          marginLeft={overlayLeft}
          marginTop={overlayTop}
          width={overlayWidth}
        >
          {overlay}
        </Box>
      ) : null}
    </Box>
  );
}
