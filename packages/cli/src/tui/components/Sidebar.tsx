import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme.js";
import type { ProfileEntry } from "../useProfiles.js";

export type ViewName = "dash" | "workspace" | "profiles" | "about" | "doctor" | "settings" | "tasks" | "memory" | "skills" | "sync" | "telemetry" | "agents";

const NAV_ITEMS: { view: ViewName; label: string }[] = [
  { view: "dash", label: "Dash" },
  { view: "workspace", label: "Work" },
  { view: "profiles", label: "Profiles" },
  { view: "doctor", label: "Doctor" },
  { view: "tasks", label: "Tasks" },
  { view: "memory", label: "Memory" },
  { view: "skills", label: "Skills" },
  { view: "settings", label: "Settings" },
  { view: "about", label: "Guide" },
  { view: "sync", label: "Sync" },
  { view: "telemetry", label: "Traces" },
  { view: "agents", label: "Agents" },
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
    <Box flexDirection="column" flexGrow={1} paddingX={0} paddingY={0}>
      {/* Logo mark — [>] ARC */}
      <Box paddingX={1}>
        <Text color={colors.dimmed}>[</Text>
        <Text color={colors.primary} bold>{">"}</Text>
        <Text color={colors.dimmed}>]</Text>
        <Text> </Text>
        <Text color={colors.primary} bold>ARC</Text>
      </Box>
      <Box paddingX={1} marginBottom={1}>
        <Text color={colors.border}>{"─".repeat(14)}</Text>
      </Box>

      {/* Navigation */}
      <Box flexDirection="column">
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
              <Text color={isActive ? colors.primary : colors.border} bold={isActive}>
                {isActive ? "▸ " : "  "}
              </Text>
              <Text color={textColor} bold={isActive}>
                {item.label}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Active profile */}
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text color={colors.border}>{"─".repeat(14)}</Text>
        <Text color={colors.dimmed}>active</Text>
        <Text color={activeProfile ? colors.text : colors.dimmed} bold={Boolean(activeProfile)}>
          {activeProfile?.name ?? "none"}
        </Text>
        <Text color={colors.dimmed}>
          {readyCount}/{profiles.length} ready
        </Text>
      </Box>

      {/* Queue */}
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text color={colors.border}>{"─".repeat(14)}</Text>
        {profiles.length === 0 ? (
          <Text color={colors.dimmed}>no profiles</Text>
        ) : (
          profiles.slice(0, 5).map((profile) => (
            <Box key={profile.name}>
              <Text color={profile.active ? colors.accent : colors.dimmed}>
                {profile.active ? "● " : "○ "}
              </Text>
              <Text
                color={profile.active ? colors.text : colors.dimmed}
                bold={profile.active}
              >
                {profile.name}
              </Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
