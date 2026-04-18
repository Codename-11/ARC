import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import type { ProfileEntry } from "../useProfiles.js";

export type ViewName = "dash" | "workspace" | "profiles" | "about" | "doctor" | "settings" | "tasks" | "memory" | "skills" | "sync" | "telemetry" | "agents";

export const NAV_ITEMS: { view: ViewName; label: string }[] = [
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

/** Max number of profile rows rendered in the sidebar queue. */
export const SIDEBAR_PROFILE_LIMIT = 5;

/**
 * Returns the count of selectable profile rows in the sidebar (capped).
 */
export function sidebarProfileCount(profiles: ProfileEntry[]): number {
  return Math.min(profiles.length, SIDEBAR_PROFILE_LIMIT);
}

/**
 * Total selectable rows in the sidebar (nav items + visible profile rows).
 */
export function sidebarSelectableCount(profiles: ProfileEntry[]): number {
  return NAV_ITEMS.length + sidebarProfileCount(profiles);
}

/**
 * Index at which profile rows begin in the combined selection list.
 */
export const SIDEBAR_PROFILES_START = NAV_ITEMS.length;

interface SidebarProps {
  activeView: ViewName;
  profiles: ProfileEntry[];
  focusedPane: "sidebar" | "content";
  /**
   * 0-indexed position in the combined [nav..., profiles...] list.
   * Drives the visual highlight when sidebar is focused.
   */
  selectedIndex: number;
}

export function Sidebar({
  activeView,
  profiles,
  focusedPane,
  selectedIndex,
}: SidebarProps) {
  const { theme } = useTheme();
  const { colors } = theme;
  const isFocused = focusedPane === "sidebar";
  const activeProfile = profiles.find((profile) => profile.active);
  const readyCount = profiles.filter((profile) => profile.credential?.authenticated).length;
  const visibleProfiles = profiles.slice(0, SIDEBAR_PROFILE_LIMIT);

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
          const isHighlighted = isFocused && index === selectedIndex;

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
        {visibleProfiles.length === 0 ? (
          <Text color={colors.dimmed}>no profiles</Text>
        ) : (
          visibleProfiles.map((profile, index) => {
            const combinedIndex = SIDEBAR_PROFILES_START + index;
            const isHighlighted = isFocused && combinedIndex === selectedIndex;
            return (
              <Box
                key={profile.name}
                backgroundColor={isHighlighted ? colors.bgSelected : undefined}
              >
                <Text color={isHighlighted ? colors.text : colors.dimmed}>
                  {isHighlighted ? "›" : " "}
                </Text>
                <Text color={profile.active ? colors.accent : colors.dimmed}>
                  {profile.active ? "● " : " ○ "}
                </Text>
                <Text
                  color={
                    isHighlighted
                      ? colors.text
                      : profile.active
                        ? colors.text
                        : colors.dimmed
                  }
                  bold={profile.active}
                >
                  {profile.name}
                </Text>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
