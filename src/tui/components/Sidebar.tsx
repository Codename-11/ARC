import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme.js";
import type { ProfileEntry } from "../useProfiles.js";

export type ViewName = "workspace" | "profiles" | "settings" | "doctor";

const NAV_ITEMS: { view: ViewName; label: string; icon: string }[] = [
  { view: "workspace", label: "Workspace", icon: "◇" },
  { view: "profiles", label: "Profiles", icon: "◎" },
  { view: "doctor", label: "Doctor", icon: "+" },
  { view: "settings", label: "Settings", icon: ":" },
];

interface SidebarProps {
  activeView: ViewName;
  onViewChange: (view: ViewName) => void;
  profiles: ProfileEntry[];
  focusedPane: "sidebar" | "content";
  inputEnabled: boolean;
}

export function Sidebar({
  activeView,
  onViewChange,
  profiles,
  focusedPane,
  inputEnabled,
}: SidebarProps) {
  const { theme } = useTheme();
  const { colors } = theme;
  const isFocused = focusedPane === "sidebar";
  const navIndex = Math.max(0, NAV_ITEMS.findIndex((item) => item.view === activeView));
  const activeProfile = profiles.find((profile) => profile.active);
  const readyCount = profiles.filter((profile) => profile.credential?.authenticated).length;

  useInput(
    (_, key) => {
      if (!isFocused || !inputEnabled) return;

      if (key.upArrow) {
        const previous = NAV_ITEMS[Math.max(0, navIndex - 1)];
        if (previous) onViewChange(previous.view);
        return;
      }

      if (key.downArrow) {
        const next = NAV_ITEMS[Math.min(NAV_ITEMS.length - 1, navIndex + 1)];
        if (next) onViewChange(next.view);
      }
    },
    { isActive: isFocused && inputEnabled }
  );

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
      <Box flexDirection="column" paddingLeft={1} marginBottom={1}>
        <Text color={colors.secondary} bold>
          ARC shell
        </Text>
        <Text color={colors.dimmed}>Launch-first workspace</Text>
      </Box>

      <Box flexDirection="column" gap={0}>
        {NAV_ITEMS.map((item, index) => {
          const isActive = item.view === activeView;
          const isHighlighted = isFocused && index === navIndex;

          let textColor = colors.dimmed;
          if (isActive) textColor = colors.primary;
          else if (isHighlighted) textColor = colors.text;

          return (
            <Box
              key={item.view}
              paddingX={1}
              backgroundColor={isHighlighted && !isActive ? colors.bgSelected : undefined}
            >
              <Text
                color={isActive ? colors.primary : colors.border}
                bold={isActive}
              >
                {isActive ? "▶ " : "  "}
              </Text>
              <Text color={isActive ? colors.secondary : colors.dimmed}>
                {item.icon}{" "}
              </Text>
              <Text color={textColor} bold={isActive}>
                {item.label}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginY={1} paddingLeft={1}>
        <Text color={colors.border}>status</Text>
      </Box>

      <Box flexDirection="column" paddingLeft={1} gap={1}>
        <Box flexDirection="column">
          <Text color={colors.dimmed}>active profile</Text>
          <Text color={activeProfile ? colors.text : colors.dimmed} bold={Boolean(activeProfile)}>
            {activeProfile?.name ?? "none"}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text color={colors.dimmed}>profiles ready</Text>
          <Text color={profiles.length > 0 ? colors.text : colors.dimmed}>
            {readyCount}/{profiles.length}
          </Text>
        </Box>
      </Box>

      <Box marginY={1} paddingLeft={1}>
        <Text color={colors.border}>queue</Text>
      </Box>

      <Box flexDirection="column" paddingLeft={1}>
        {profiles.length === 0 ? (
          <Box gap={1}>
            <Text color={colors.dimmed}>○</Text>
            <Text color={colors.dimmed}>none</Text>
          </Box>
        ) : (
          profiles.slice(0, 5).map((profile) => (
            <Box key={profile.name} gap={1} alignItems="center">
              <Text color={profile.active ? colors.accent : colors.dimmed}>
                {profile.active ? "●" : "○"}
              </Text>
              <Text
                color={profile.active ? colors.text : colors.dimmed}
                bold={profile.active}
              >
                {profile.name}
              </Text>
              <Text
                color={
                  profile.credential?.authenticated ? colors.success : colors.dimmed
                }
              >
                {profile.credential?.authenticated ? "ready" : "setup"}
              </Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
