import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Box, Text, useInput } from "ink";
import { Spinner } from "@inkjs/ui";
import { ImportHint } from "../components/ImportHint.js";
import { useTheme } from "../theme.js";
import { loadConfig, saveConfig } from "../../config.js";
import { handleLaunch } from "../../commands/launch.js";
import type { ProfileEntry } from "../useProfiles.js";
import type { ViewName } from "../components/Sidebar.js";

interface Props {
  profiles: ProfileEntry[];
  loading: boolean;
  reload: () => void;
  focusedPane: "sidebar" | "content";
  onViewChange: (view: ViewName) => void;
  inputEnabled: boolean;
  onTypingChange: (typing: boolean) => void;
}

interface ActivityEntry {
  role: string;
  text: string;
  tone?: "default" | "success" | "warning";
}

function SectionTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  const { theme } = useTheme();

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={theme.colors.primary}>
        {title}
      </Text>
      {subtitle ? (
        <Text color={theme.colors.dimmed}>{subtitle}</Text>
      ) : null}
    </Box>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { theme } = useTheme();
  const { colors } = theme;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.border}
      paddingX={1}
      paddingY={1}
      backgroundColor={colors.bgPanel}
    >
      <SectionTitle title={title} subtitle={subtitle} />
      {children}
    </Box>
  );
}

function TranscriptMessage({
  role,
  text,
  tone = "default",
}: {
  role: string;
  text: string;
  tone?: "default" | "success" | "warning";
}) {
  const { theme } = useTheme();
  const { colors } = theme;

  const roleColor =
    role === "system"
      ? colors.secondary
      : role === "arc"
        ? colors.primary
        : colors.text;

  const textColor =
    tone === "success"
      ? colors.success
      : tone === "warning"
        ? colors.warning
        : colors.text;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={roleColor} bold>
        {role}
      </Text>
      <Text color={textColor}>{text}</Text>
    </Box>
  );
}

function QueueRow({
  profile,
  selected,
}: {
  profile: ProfileEntry;
  selected: boolean;
}) {
  const { theme } = useTheme();
  const { colors } = theme;
  const health = profile.credError
    ? { icon: "!", color: colors.error, label: "check failed" }
    : profile.credential?.expired
      ? { icon: "!", color: colors.warning, label: "expired" }
      : profile.credential?.authenticated
        ? { icon: "●", color: colors.success, label: "ready" }
        : { icon: "○", color: colors.dimmed, label: "setup needed" };

  return (
    <Box
      justifyContent="space-between"
      backgroundColor={selected ? colors.bgSelected : undefined}
      paddingX={1}
    >
      <Box gap={1}>
        <Text color={selected ? colors.primary : colors.border}>
          {selected ? ">" : " "}
        </Text>
        <Text color={profile.active ? colors.accent : colors.text} bold={profile.active}>
          {profile.name}
        </Text>
        <Text color={colors.dimmed}>{profile.tool}</Text>
      </Box>
      <Box gap={1}>
        <Text color={health.color}>{health.icon}</Text>
        <Text color={health.color}>{health.label}</Text>
      </Box>
    </Box>
  );
}

export function SessionView({
  profiles,
  loading,
  reload,
  focusedPane,
  onViewChange,
  inputEnabled,
  onTypingChange,
}: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [composer, setComposer] = useState("");
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const activeProfile = profiles.find((profile) => profile.active) ?? profiles[0];
  const readyProfiles = profiles.filter((profile) => profile.credential?.authenticated);
  const pendingProfiles = profiles.filter((profile) => !profile.credential?.authenticated);
  const queue = [...readyProfiles, ...pendingProfiles].slice(0, 5);
  const selectedProfile = queue[selectedIndex] ?? activeProfile;
  const isContentFocused = focusedPane === "content" && inputEnabled;

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, queue.length - 1)));
  }, [queue.length]);

  const transcript = useMemo<ActivityEntry[]>(() => {
    if (!activeProfile) {
      return [
        {
          role: "system",
          text: "No profiles found yet. Create or import one to populate the workspace.",
          tone: "warning",
        },
      ];
    }

    return [
      {
        role: "system",
        text: `ARC is focused on ${activeProfile.name}. Use this surface for launch, switch, and diagnostics instead of bouncing between static pages.`,
      },
      {
        role: "user",
        text: `Prepare ${activeProfile.tool} with the ${activeProfile.authType} profile and keep the environment isolated.`,
      },
      {
        role: "arc",
        text: activeProfile.credential?.authenticated
          ? `Ready to launch ${activeProfile.name}. Credentials are present and the workspace shell can now center around session history and command entry.`
          : `Profile ${activeProfile.name} still needs credentials or setup. This is where ARC should surface guided recovery steps next.`,
        tone: activeProfile.credential?.authenticated ? "success" : "warning",
      },
      ...activity,
    ];
  }, [activeProfile, activity]);

  const commandSuggestions = useMemo(() => {
    const items = [
      { command: "/launch", desc: "Launch the selected or named profile." },
      { command: "/switch", desc: "Set the selected or named profile active." },
      { command: "/profiles", desc: "Open the profiles queue view." },
      { command: "/doctor", desc: "Open diagnostics." },
      { command: "/settings", desc: "Open settings." },
      { command: "/clear", desc: "Clear activity from this workspace." },
    ];

    if (!composer.startsWith("/")) {
      return items.slice(0, 3);
    }

    return items.filter((item) => item.command.startsWith(composer.trim()));
  }, [composer]);

  const recentCommands = useMemo(
    () =>
      activity
        .filter((entry) => entry.role === "user" && entry.text.startsWith("/"))
        .slice(-3)
        .reverse(),
    [activity]
  );

  useEffect(() => {
    onTypingChange(composer.length > 0);
    return () => {
      onTypingChange(false);
    };
  }, [composer.length, onTypingChange]);

  useInput(
    async (input, key) => {
      if (!isContentFocused) {
        return;
      }

      if (key.upArrow) {
        if (queue.length === 0) {
          return;
        }
        setSelectedIndex((current) => Math.max(0, current - 1));
        return;
      }

      if (key.downArrow) {
        if (queue.length === 0) {
          return;
        }
        setSelectedIndex((current) => Math.min(queue.length - 1, current + 1));
        return;
      }

      if (key.backspace || key.delete) {
        setComposer((current) => current.slice(0, -1));
        return;
      }

      if (key.escape) {
        setComposer("");
        return;
      }

      if (key.return) {
        const value = composer.trim();

        if (!value) {
          if (!selectedProfile) {
            return;
          }

          setActivity((current) => [
            ...current,
            {
              role: "arc",
              text: `Launching ${selectedProfile.name} via ${selectedProfile.tool}.`,
              tone: "success",
            },
          ]);
          await handleLaunch(selectedProfile.name, []);
          return;
        }

        const [command, ...args] = value.split(/\s+/);
        const targetName = args.join(" ").trim();
        const namedTarget = targetName
          ? profiles.find((profile) => profile.name === targetName)
          : undefined;
        const target = targetName ? namedTarget : selectedProfile;

        if (command === "/launch") {
          if (!target) {
            setActivity((current) => [
              ...current,
              {
                role: "arc",
                text: "No profile available to launch.",
                tone: "warning",
              },
            ]);
            setComposer("");
            return;
          }

          if (targetName && !namedTarget) {
            setActivity((current) => [
              ...current,
              {
                role: "user",
                text: value,
              },
              {
                role: "arc",
                text: `Profile "${targetName}" was not found.`,
                tone: "warning",
              },
            ]);
            setComposer("");
            return;
          }

          setActivity((current) => [
            ...current,
            {
              role: "user",
              text: value,
            },
            {
              role: "arc",
              text: `Launching ${target.name} via ${target.tool}.`,
              tone: "success",
            },
          ]);
          setComposer("");
          await handleLaunch(target.name, []);
          return;
        }

        if (command === "/switch") {
          if (!target) {
            setActivity((current) => [
              ...current,
              {
                role: "arc",
                text: "Choose a profile with the queue or pass a name to /switch.",
                tone: "warning",
              },
            ]);
            setComposer("");
            return;
          }

          if (targetName && !namedTarget) {
            setActivity((current) => [
              ...current,
              {
                role: "user",
                text: value,
              },
              {
                role: "arc",
                text: `Profile "${targetName}" was not found.`,
                tone: "warning",
              },
            ]);
            setComposer("");
            return;
          }

          const config = loadConfig();
          config.activeProfile = target.name;
          saveConfig(config);
          setActivity((current) => [
            ...current,
            {
              role: "user",
              text: value,
            },
            {
              role: "arc",
              text: `Switched active profile to ${target.name}.`,
              tone: "success",
            },
          ]);
          setComposer("");
          reload();
          return;
        }

        if (command === "/profiles" || command === "/doctor" || command === "/settings") {
          const destination = command.slice(1) as ViewName;
          setActivity((current) => [
            ...current,
            {
              role: "user",
              text: value,
            },
            {
              role: "arc",
              text: `Opening ${destination}.`,
              tone: "success",
            },
          ]);
          setComposer("");
          onViewChange(destination);
          return;
        }

        if (command === "/help") {
          setActivity((current) => [
            ...current,
            {
              role: "user",
              text: value,
            },
            {
              role: "arc",
              text: "Use Ctrl+P for the palette, ? for help, Enter to launch the selected queue item, and /switch to change the active profile.",
              tone: "success",
            },
          ]);
          setComposer("");
          return;
        }

        if (command === "/create") {
          setActivity((current) => [
            ...current,
            {
              role: "user",
              text: value,
            },
            {
              role: "arc",
              text: "Leave the TUI and run: arc create <name> --tool <tool> --auth-type <type>",
              tone: "warning",
            },
          ]);
          setComposer("");
          return;
        }

        if (command === "/clear") {
          setActivity([]);
          setComposer("");
          return;
        }

        setActivity((current) => [
          ...current,
          {
            role: "user",
            text: value,
          },
          {
            role: "arc",
            text: "Commands available today: /launch, /switch, /profiles, /doctor, /settings, /help, /create, /clear.",
            tone: "warning",
          },
        ]);
        setComposer("");
        return;
      }

      if (!key.ctrl && !key.meta && input.length === 1) {
        setComposer((current) => current + input);
      }
    },
    { isActive: isContentFocused }
  );

  if (loading) {
    return (
      <Box paddingY={1}>
        <Spinner label="Building workspace..." />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1} justifyContent="space-between">
        <Box flexDirection="column">
          <Text color={colors.secondary} bold>
            Session Workspace
          </Text>
          <Text color={colors.dimmed}>
            Shape the shell around launch flow, agent state, and fast switching.
          </Text>
        </Box>
        <Box gap={2}>
          <Box flexDirection="column" alignItems="flex-end">
            <Text color={colors.dimmed}>Profiles online</Text>
            <Text color={colors.text} bold>
              {readyProfiles.length}/{profiles.length}
            </Text>
          </Box>
          <Box flexDirection="column" alignItems="flex-end">
            <Text color={colors.dimmed}>Active tool</Text>
            <Text color={colors.text} bold>
              {activeProfile?.tool ?? "none"}
            </Text>
          </Box>
        </Box>
      </Box>

      <Box gap={1}>
        <Box flexDirection="column" flexGrow={1} gap={1}>
          <Panel
            title="Transcript"
            subtitle="A Code-style center pane for live status, prompts, and launch intent."
          >
            {transcript.length > 0 ? (
              transcript.slice(-6).map((entry, index) => (
                <TranscriptMessage
                  key={`${entry.role}-${index}-${entry.text}`}
                  role={entry.role}
                  text={entry.text}
                  tone={entry.tone}
                />
              ))
            ) : (
              <TranscriptMessage
                role="system"
                text="No transcript entries yet."
                tone="warning"
              />
            )}
          </Panel>

          <Panel
            title="Composer"
            subtitle="The footer and input model should eventually behave like a command-first agent shell."
          >
            <Box
              borderStyle="single"
              borderColor={colors.border}
              paddingX={1}
              paddingY={1}
            >
              <Text color={composer ? colors.text : colors.dimmed}>
                {composer ||
                  (activeProfile
                    ? `/launch ${activeProfile.name}`
                    : "Type /profiles or /settings to get started")}
              </Text>
            </Box>
            <Box marginTop={1} gap={2}>
              {commandSuggestions.map((item) => (
                <Box key={item.command} flexDirection="column" marginRight={2}>
                  <Text color={colors.primary}>{item.command}</Text>
                  <Text color={colors.dimmed}>{item.desc}</Text>
                </Box>
              ))}
            </Box>
          </Panel>
        </Box>

        <Box flexDirection="column" width={34} gap={1}>
          <Panel
            title="Queue"
            subtitle="Profiles staged for quick launch and follow-up."
          >
            {queue.length > 0 ? (
              <Box flexDirection="column" gap={0}>
                {queue.map((profile, index) => (
                  <QueueRow
                    key={profile.name}
                    profile={profile}
                    selected={index === selectedIndex}
                  />
                ))}
              </Box>
            ) : (
              <Text color={colors.dimmed}>No profiles available yet.</Text>
            )}
          </Panel>

          <Panel
            title="Inspector"
            subtitle="Details for the currently active profile."
          >
            {activeProfile ? (
              <Box flexDirection="column" gap={1}>
                <Box justifyContent="space-between">
                  <Text color={colors.dimmed}>Name</Text>
                  <Text color={colors.text} bold>
                    {selectedProfile?.name ?? activeProfile.name}
                  </Text>
                </Box>
                <Box justifyContent="space-between">
                  <Text color={colors.dimmed}>Tool</Text>
                  <Text color={colors.text}>{selectedProfile?.tool ?? activeProfile.tool}</Text>
                </Box>
                <Box justifyContent="space-between">
                  <Text color={colors.dimmed}>Auth</Text>
                  <Text color={colors.text}>
                    {selectedProfile?.authType ?? activeProfile.authType}
                  </Text>
                </Box>
                <Box justifyContent="space-between">
                  <Text color={colors.dimmed}>State</Text>
                  <Text
                    color={
                      selectedProfile?.credential?.authenticated
                        ? colors.success
                        : colors.warning
                    }
                  >
                    {selectedProfile?.credential?.authenticated ? "ready" : "attention needed"}
                  </Text>
                </Box>
                <Box flexDirection="column" marginTop={1}>
                  <Text color={colors.dimmed}>Next shell steps</Text>
                  <Text color={colors.text}>Enter: launch selected profile</Text>
                  <Text color={colors.text}>/switch: make it active</Text>
                  <Text color={colors.text}>/doctor: open diagnostics</Text>
                </Box>
                {recentCommands.length > 0 ? (
                  <Box flexDirection="column" marginTop={1}>
                    <Text color={colors.dimmed}>Recent commands</Text>
                    {recentCommands.map((entry, index) => (
                      <Text key={`${entry.text}-${index}`} color={colors.text}>
                        {entry.text}
                      </Text>
                    ))}
                  </Box>
                ) : null}
              </Box>
            ) : (
              <Text color={colors.dimmed}>Select a profile to inspect it.</Text>
            )}
          </Panel>
        </Box>
      </Box>

      <ImportHint profiles={profiles} />
    </Box>
  );
}
