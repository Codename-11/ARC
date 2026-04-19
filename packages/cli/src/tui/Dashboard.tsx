import { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Spinner } from "@inkjs/ui";
import { useScreenSize } from "fullscreen-ink";
import { Layout } from "./components/Layout.js";
import {
  Sidebar,
  NAV_ITEMS,
  SIDEBAR_PROFILES_START,
  sidebarSelectableCount,
  sidebarProfileCount,
  type ViewName,
} from "./components/Sidebar.js";
import { SessionView } from "./views/SessionView.js";
import { ProfilesView } from "./views/ProfilesView.js";
import { SettingsView } from "./views/SettingsView.js";
import { DoctorView } from "./views/DoctorView.js";
import { AboutView } from "./views/AboutView.js";
import { DashView } from "./views/DashView.js";
import { TasksView } from "./views/TasksView.js";
import { MemoryView } from "./views/MemoryView.js";
import { SkillsView } from "./views/SkillsView.js";
import { SyncView } from "./views/SyncView.js";
import { TelemetryView } from "./views/TelemetryView.js";
import { AgentsView } from "./views/AgentsView.js";
import { CommandPalette, type PaletteItem } from "./views/CommandPalette.js";
import { HelpOverlay } from "./views/HelpOverlay.js";
import { CreateProfileOverlay } from "./views/CreateProfileOverlay.js";
import { Overlay } from "./components/Overlay.js";
import { SwapOverlay } from "./views/SwapOverlay.js";
import { SharedDetailOverlay } from "./views/SharedDetailOverlay.js";
import { ProfileInfoOverlay } from "./views/ProfileInfoOverlay.js";
import { OnboardingScreen } from "./views/OnboardingScreen.js";
import { useProfiles } from "./useProfiles.js";
import { useTheme } from "./theme.js";
import { ToastProvider, useToast } from "./useToast.js";
import { ToastContainer } from "./components/Toast.js";
import { runSelfUpdate } from "../update.js";
import { handleLaunch } from "../commands/launch.js";
import { markLaunchPending } from "./render.js";

const MIN_WIDTH = 72;
const MIN_HEIGHT = 18;
type OverlayName = "palette" | "help" | "create" | "updating" | "swap" | "about" | "shared-detail" | "profile-info" | null;

export function Dashboard() {
  return (
    <ToastProvider>
      <DashboardInner />
    </ToastProvider>
  );
}

function DashboardInner() {
  const { toasts } = useToast();
  const { profiles, loading, config, reload } = useProfiles();
  const { exit } = useApp();
  const { toggleTheme, theme } = useTheme();
  const { width, height } = useScreenSize();
  const [activeView, setActiveView] = useState<ViewName>("dash");
  const [focusedPane, setFocusedPane] = useState<"sidebar" | "content">("sidebar");
  const [overlay, setOverlay] = useState<OverlayName>(null);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [workspaceTyping, setWorkspaceTyping] = useState(false);
  const [activity, setActivity] = useState<import("./views/SessionView.js").ActivityEntry[]>([]);
  const [infoProfile, setInfoProfile] = useState<string | null>(null);
  // 0-indexed position in the combined sidebar list [nav..., visible profiles...].
  const [sidebarSelection, setSidebarSelection] = useState(0);

  const selectableCount = sidebarSelectableCount(profiles);
  useEffect(() => {
    if (selectableCount === 0) return;
    if (sidebarSelection >= selectableCount) {
      setSidebarSelection(selectableCount - 1);
    }
  }, [selectableCount, sidebarSelection]);

  useEffect(() => {
    const navIdx = NAV_ITEMS.findIndex((item) => item.view === activeView);
    if (navIdx >= 0 && sidebarSelection < NAV_ITEMS.length) {
      setSidebarSelection(navIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  const paletteItems: PaletteItem[] = [
    { id: "dash", label: "Dashboard", description: "Overview and status" },
    { id: "workspace", label: "Workspace", description: "Open the session shell" },
    { id: "profiles", label: "Profiles", description: "Manage launch targets" },
    { id: "about", label: "Guide", description: "Profiles, shared layer, hot-swap docs" },
    { id: "doctor", label: "Doctor", description: "Run diagnostics" },
    { id: "settings", label: "Settings", description: "Inspect shell config" },
    { id: "tasks", label: "Tasks", description: "View and manage agent tasks" },
    { id: "memory", label: "Memory", description: "Browse persistent memory entries" },
    { id: "skills", label: "Skills", description: "View registered skills and status" },
    { id: "sync", label: "Sync", description: "Shared layer sync status and items" },
    { id: "telemetry", label: "Traces", description: "Recent telemetry traces and sessions" },
    { id: "agents", label: "Agents", description: "Remote agent connections and status" },
    { id: "theme", label: "Toggle Theme", description: "Switch light and dark mode" },
    { id: "create", label: "Create Profile", description: "Import or create a new profile" },
    { id: "swap", label: "Swap Credentials", description: "[experimental] Switch accounts, keep config" },
    { id: "shared-detail", label: "Shared Layer", description: "View shared MCPs, commands, and sync state" },
  ];

  const [updateResult, setUpdateResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleCreateSuccess = (name: string) => {
    setOverlay(null);
    reload();
    setActiveView("profiles");
    setFocusedPane("content");
  };

  const handleTriggerUpdate = () => {
    setOverlay("updating");
    setUpdateResult(null);
    runSelfUpdate().then((result) => {
      setUpdateResult(result);
    });
  };

  const choosePaletteItem = (item: PaletteItem) => {
    setOverlay(null);

    if (item.id === "theme") {
      toggleTheme();
      return;
    }

    if (item.id === "create") {
      setOverlay("create");
      return;
    }

    if (item.id === "swap") {
      setOverlay("swap");
      return;
    }

    if (item.id === "shared-detail") {
      setOverlay("shared-detail");
      return;
    }

    setActiveView(item.id as ViewName);
    setFocusedPane("content");
  };

  const showOnboarding = !loading && profiles.length === 0;

  useInput((input, key) => {
    const sidebarFocused = focusedPane === "sidebar";

    if (overlay) {
      if (key.escape) {
        setOverlay(null);
      }
      return;
    }

    // --- Global shortcuts (Ctrl-modified, work in any pane) ---
    if (key.ctrl && input === "p") {
      setPaletteIndex(0);
      setOverlay("palette");
      return;
    }

    if (key.ctrl && (input === "q" || input === "c")) {
      exit();
      return;
    }

    if (key.ctrl && input === "t") {
      toggleTheme();
      return;
    }

    if (key.tab) {
      setFocusedPane((current) => (current === "sidebar" ? "content" : "sidebar"));
      return;
    }

    // --- Dash quick-launch (Enter when content pane is focused on dash) ---
    if (key.return && activeView === "dash" && !sidebarFocused) {
      const active = profiles.find((p) => p.active);
      if (active) {
        markLaunchPending();
        setTimeout(() => {
          handleLaunch(active.name, [], { beforeSpawn: exit });
        }, 0);
      }
      return;
    }

    // --- Sidebar-only shortcuts (bare keys safe — no text input in sidebar) ---
    if (!sidebarFocused) return;

    if (input === "?") {
      setOverlay("help");
      return;
    }

    if (input === "q") {
      exit();
      return;
    }

    if (input === "t") {
      toggleTheme();
      return;
    }

    if (input === "c") {
      setOverlay("create");
      return;
    }

    if (input === "u" && activeView === "dash") {
      handleTriggerUpdate();
      return;
    }

    // --- Sidebar navigation (combined nav + profile queue) ---
    const profileCount = sidebarProfileCount(profiles);
    const total = NAV_ITEMS.length + profileCount;

    if (key.upArrow) {
      if (total === 0) return;
      setSidebarSelection((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      if (total === 0) return;
      setSidebarSelection((prev) => Math.min(total - 1, prev + 1));
      return;
    }

    if (key.return) {
      if (sidebarSelection < NAV_ITEMS.length) {
        const item = NAV_ITEMS[sidebarSelection];
        if (item) setActiveView(item.view);
        return;
      }
      const profileIdx = sidebarSelection - SIDEBAR_PROFILES_START;
      const profile = profiles.slice(0, profileCount)[profileIdx];
      if (profile) {
        markLaunchPending();
        setTimeout(() => {
          handleLaunch(profile.name, [], { beforeSpawn: exit });
        }, 0);
      }
      return;
    }
  }, { isActive: !showOnboarding });

  const tooSmall = width < MIN_WIDTH || height < MIN_HEIGHT;

  const content = useMemo(() => {
    switch (activeView) {
      case "dash":
        return <DashView profiles={profiles} onTriggerUpdate={handleTriggerUpdate} />;
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
            onCreateProfile={() => setOverlay("create")}
            onExitApp={exit}
            activity={activity}
            onActivityChange={setActivity}
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
            onCreateProfile={() => setOverlay("create")}
            onExitApp={exit}
            onShowInfo={(name) => {
              setInfoProfile(name);
              setOverlay("profile-info");
            }}
          />
        );
      case "settings":
        return <SettingsView config={config} profiles={profiles} focusedPane={focusedPane} inputEnabled={overlay === null} reload={reload} />;
      case "about":
        return <AboutView focusedPane={focusedPane} inputEnabled={overlay === null} />;
      case "doctor":
        return <DoctorView profiles={profiles} />;
      case "tasks":
        return <TasksView focusedPane={focusedPane} inputEnabled={overlay === null} />;
      case "memory":
        return <MemoryView focusedPane={focusedPane} inputEnabled={overlay === null} />;
      case "skills":
        return <SkillsView focusedPane={focusedPane} inputEnabled={overlay === null} />;
      case "sync":
        return <SyncView profiles={profiles} focusedPane={focusedPane} inputEnabled={overlay === null} />;
      case "telemetry":
        return <TelemetryView profiles={profiles} focusedPane={focusedPane} inputEnabled={overlay === null} />;
      case "agents":
        return <AgentsView profiles={profiles} focusedPane={focusedPane} inputEnabled={overlay === null} />;
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
            onCreateProfile={() => setOverlay("create")}
            onExitApp={exit}
            activity={activity}
            onActivityChange={setActivity}
          />
        );
    }
  }, [activeView, activity, config, exit, focusedPane, loading, overlay, profiles, reload, workspaceTyping]);

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
    ) : overlay === "create" ? (
      <CreateProfileOverlay
        existingNames={profiles.map((p) => p.name)}
        existingTools={profiles.map((p) => p.tool)}
        onSuccess={handleCreateSuccess}
        onCancel={() => setOverlay(null)}
      />
    ) : overlay === "swap" ? (
      <SwapOverlay
        onClose={() => setOverlay(null)}
        onSwapped={reload}
      />
    ) : overlay === "shared-detail" ? (
      <SharedDetailOverlay
        config={config}
        onClose={() => setOverlay(null)}
      />
    ) : overlay === "profile-info" && infoProfile ? (
      (() => {
        const entry = profiles.find((p) => p.name === infoProfile);
        const profile = config.profiles[infoProfile];
        if (!entry || !profile) return null;
        return (
          <ProfileInfoOverlay
            entry={entry}
            profile={profile}
            onClose={() => {
              setOverlay(null);
              setInfoProfile(null);
            }}
          />
        );
      })()
    ) : overlay === "updating" ? (
      <Overlay title="Update" subtitle="Self-update ARC via npm">
        <Box flexDirection="column">
          {updateResult ? (
            <Box flexDirection="column">
              <Text color={updateResult.ok ? theme.colors.success : theme.colors.error}>
                {updateResult.message}
              </Text>
              <Box marginTop={1}>
                <Text color={theme.colors.dimmed}>Press esc to close.</Text>
              </Box>
            </Box>
          ) : (
            <Spinner label="Updating ARC..." />
          )}
        </Box>
      </Overlay>
    ) : null;

  // ── Fullscreen onboarding when no profiles exist ────────────────────
  // Placed after all hooks to satisfy Rules of Hooks (no early returns before hooks).
  if (showOnboarding && !tooSmall) {
    return <OnboardingScreen onComplete={reload} />;
  }

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
          <Text color={theme.colors.dimmed}>[</Text>
          <Text color={theme.colors.primary} bold>{">"}</Text>
          <Text color={theme.colors.dimmed}>]</Text>
          <Text bold color={theme.colors.primary}> ARC</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.colors.warning}>Terminal too small</Text>
          <Text color={theme.colors.dimmed}>Current: {width}×{height}</Text>
          <Text color={theme.colors.dimmed}>Minimum: {MIN_WIDTH}×{MIN_HEIGHT}</Text>
        </Box>
        <Box marginTop={1} gap={2}>
          <Box gap={0}>
            <Text bold color={theme.colors.primary}>[ctrl+t]</Text>
            <Text color={theme.colors.dimmed}> theme</Text>
          </Box>
          <Box gap={0}>
            <Text bold color={theme.colors.primary}>[ctrl+q]</Text>
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
          profiles={profiles}
          focusedPane={focusedPane}
          selectedIndex={sidebarSelection}
        />
      }
      content={<>{content}<ToastContainer toasts={toasts} /></>}
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
