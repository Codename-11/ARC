import { useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { Layout } from "./components/Layout.js";
import { Sidebar, type ViewName } from "./components/Sidebar.js";
import { SessionView } from "./views/SessionView.js";
import { ProfilesView } from "./views/ProfilesView.js";
import { SettingsView } from "./views/SettingsView.js";
import { DoctorView } from "./views/DoctorView.js";
import { CommandPalette, type PaletteItem } from "./views/CommandPalette.js";
import { HelpOverlay } from "./views/HelpOverlay.js";
import { useProfiles } from "./useProfiles.js";
import { useTheme } from "./theme.js";

const MIN_WIDTH = 72;
const MIN_HEIGHT = 18;
type OverlayName = "palette" | "help" | null;

export function Dashboard() {
  const { profiles, loading, config, reload } = useProfiles();
  const { exit } = useApp();
  const { toggleTheme, theme } = useTheme();
  const { width, height } = useScreenSize();
  const [activeView, setActiveView] = useState<ViewName>("workspace");
  const [focusedPane, setFocusedPane] = useState<"sidebar" | "content">("sidebar");
  const [overlay, setOverlay] = useState<OverlayName>(null);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [workspaceTyping, setWorkspaceTyping] = useState(false);

  const paletteItems: PaletteItem[] = [
    { id: "workspace", label: "Workspace", description: "Open the session shell" },
    { id: "profiles", label: "Profiles", description: "Manage launch targets" },
    { id: "doctor", label: "Doctor", description: "Run diagnostics" },
    { id: "settings", label: "Settings", description: "Inspect shell config" },
    { id: "theme", label: "Toggle Theme", description: "Switch light and dark mode" },
    { id: "create", label: "Create Profile", description: "Exit and show create command" },
  ];

  const handleCreateHint = () => {
    exit();
    setImmediate(() => {
      process.stdout.write(
        "Run: arc create <name> --tool <tool> --auth-type <type>\n"
      );
    });
  };

  const choosePaletteItem = (item: PaletteItem) => {
    setOverlay(null);

    if (item.id === "theme") {
      toggleTheme();
      return;
    }

    if (item.id === "create") {
      handleCreateHint();
      return;
    }

    setActiveView(item.id as ViewName);
    setFocusedPane("content");
  };

  useInput((input, key) => {
    const workspaceCapturesKeys =
      activeView === "workspace" &&
      focusedPane === "content" &&
      overlay === null &&
      workspaceTyping;

    if (overlay) {
      if (key.escape) {
        setOverlay(null);
      }
      return;
    }

    if (key.ctrl && input === "p") {
      setPaletteIndex(0);
      setOverlay("palette");
      return;
    }

    if (input === "?" && !workspaceCapturesKeys) {
      setOverlay("help");
      return;
    }

    if (input === "q" && !workspaceCapturesKeys) {
      exit();
      return;
    }

    if (input === "t" && !workspaceCapturesKeys) {
      toggleTheme();
      return;
    }

    if (input === "c" && !workspaceCapturesKeys) {
      handleCreateHint();
      return;
    }

    if (key.tab) {
      setFocusedPane((current) => (current === "sidebar" ? "content" : "sidebar"));
    }
  });

  const tooSmall = width < MIN_WIDTH || height < MIN_HEIGHT;

  const content = useMemo(() => {
    switch (activeView) {
      case "workspace":
        return (
          <SessionView
            profiles={profiles}
            loading={loading}
            reload={reload}
            focusedPane={focusedPane}
            onViewChange={setActiveView}
            inputEnabled={overlay === null}
            onTypingChange={setWorkspaceTyping}
          />
        );
      case "profiles":
        return (
          <ProfilesView
            profiles={profiles}
            loading={loading}
            reload={reload}
            focusedPane={focusedPane}
            inputEnabled={overlay === null}
          />
        );
      case "settings":
        return <SettingsView config={config} profiles={profiles} />;
      case "doctor":
        return <DoctorView profiles={profiles} />;
      default:
        return (
          <SessionView
            profiles={profiles}
            loading={loading}
            reload={reload}
            focusedPane={focusedPane}
            onViewChange={setActiveView}
            inputEnabled={overlay === null}
            onTypingChange={setWorkspaceTyping}
          />
        );
    }
  }, [activeView, config, focusedPane, loading, overlay, profiles, reload, workspaceTyping]);

  const overlayNode =
    overlay === "palette" ? (
      <CommandPalette
        items={paletteItems}
        selectedIndex={paletteIndex}
        onSelectedIndexChange={setPaletteIndex}
        onChoose={choosePaletteItem}
      />
    ) : overlay === "help" ? (
      <HelpOverlay />
    ) : null;

  if (tooSmall) {
    return (
      <Box
        flexDirection="column"
        padding={1}
        width={width}
        height={height}
        backgroundColor={theme.colors.bg}
      >
        <Box gap={1}>
          <Text color={theme.colors.secondary} bold>◆</Text>
          <Text bold color={theme.colors.primary}>ARC</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.colors.warning}>Terminal too small</Text>
          <Text color={theme.colors.dimmed}>Current: {width}×{height}</Text>
          <Text color={theme.colors.dimmed}>Minimum: {MIN_WIDTH}×{MIN_HEIGHT}</Text>
        </Box>
        <Box marginTop={1} gap={2}>
          <Box gap={0}>
            <Text bold color={theme.colors.primary}>[t]</Text>
            <Text color={theme.colors.dimmed}> theme</Text>
          </Box>
          <Box gap={0}>
            <Text bold color={theme.colors.primary}>[q]</Text>
            <Text color={theme.colors.dimmed}> quit</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Layout
      hasProfiles={profiles.length > 0}
      activeView={activeView}
      focusedPane={focusedPane}
      profiles={profiles}
      sidebar={
        <Sidebar
          activeView={activeView}
          onViewChange={setActiveView}
          profiles={profiles}
          focusedPane={focusedPane}
          inputEnabled={overlay === null}
        />
      }
      content={content}
      overlay={overlayNode}
      overlayOpen={overlay !== null}
      overlayName={overlay}
      workspaceTyping={
        activeView === "workspace" &&
        focusedPane === "content" &&
        overlay === null &&
        workspaceTyping
      }
    />
  );
}
