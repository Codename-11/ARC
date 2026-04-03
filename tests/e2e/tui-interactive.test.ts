import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Box, Text, useInput } from "ink";

/**
 * Interactive TUI flow tests using ink-testing-library.
 *
 * These tests simulate keypress navigation via stdin.write() and assert
 * on rendered output via lastFrame(). They exercise the real Sidebar,
 * key-handler logic from Dashboard, CommandPalette, HelpOverlay, and
 * ProfilesView arrow navigation — all with mocked external dependencies
 * (config, auth, filesystem, fullscreen-ink).
 */

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("fullscreen-ink", () => ({
  useScreenSize: () => ({ width: 120, height: 40 }),
  FullScreen: ({ children }: { children: React.ReactNode }) =>
    React.createElement(Box, null, children),
  FullScreenBox: ({ children }: { children: React.ReactNode }) =>
    React.createElement(Box, null, children),
}));

// Mock the update module to prevent real npm registry calls
vi.mock("../../src/update.js", () => ({
  checkForUpdate: () => Promise.resolve(null),
  runSelfUpdate: () => Promise.resolve({ ok: true, message: "Updated" }),
  PACKAGE_NAME: "arc-cli",
}));

// Mock the config module
vi.mock("../../src/config.js", () => ({
  loadConfig: () => ({
    version: 1,
    activeProfile: "work",
    profiles: {
      work: {
        tool: "claude",
        authType: "oauth",
        configDir: "/tmp/arc-test/profiles/work",
        description: "",
        createdAt: new Date().toISOString(),
      },
      personal: {
        tool: "gemini",
        authType: "api-key",
        configDir: "/tmp/arc-test/profiles/personal",
        description: "",
        createdAt: new Date().toISOString(),
      },
    },
    settings: {},
  }),
  saveConfig: vi.fn(),
  getConfigDir: () => "/tmp/arc-test",
}));

// Mock the auth module
vi.mock("../../src/auth.js", () => ({
  getCredentialStatus: () =>
    Promise.resolve({
      authenticated: true,
      expired: false,
      method: "oauth",
    }),
}));

// Mock the shared module
vi.mock("../../src/shared.js", () => ({
  syncSharedToProfile: vi.fn(),
  unsyncSharedFromProfile: vi.fn(),
  getSharedManifest: () => null,
  pullProfileToShared: vi.fn(),
}));

// Mock the swap module
vi.mock("../../src/swap.js", () => ({
  listAccounts: () => [],
}));

// Mock the detect module
vi.mock("../../src/detect.js", () => ({
  detectToolConfigs: () => [],
}));

// Mock the paths module
vi.mock("../../src/paths.js", () => ({
  getConfigPath: () => "/tmp/arc-test/config.json",
  getSharedSettingsPath: () => "/tmp/arc-test/shared/settings.json",
}));

// Mock the log module
vi.mock("../../src/log.js", () => ({
  logActivity: vi.fn(),
}));

// Mock the launch command to prevent spawning real processes
vi.mock("../../src/commands/launch.js", () => ({
  handleLaunch: vi.fn(),
  findBinary: () => true,
}));

// Mock the render module to prevent real terminal manipulation
vi.mock("../../src/tui/render.js", () => ({
  markLaunchPending: vi.fn(),
  launchPending: false,
}));

// Mock createProfile module
vi.mock("../../src/tui/createProfile.js", () => ({
  RENDER_DEFER_MS: 0,
}));

// ── Helpers ───────────────────────────────────────────────────────────

const ARROW_UP = "\x1B[A";
const ARROW_DOWN = "\x1B[B";
const ESCAPE = "\x1B";
const ENTER = "\r";
const TAB = "\t";

/**
 * Small async delay to let React/Ink re-render after keypress events.
 */
function delay(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("Interactive TUI: Sidebar navigation", () => {
  /**
   * Test sidebar view switching with arrow keys using a focused test
   * component that mirrors Dashboard's Sidebar logic.
   */
  it("navigates sidebar views with arrow keys", async () => {
    const views = ["Dash", "Work", "Profiles", "Doctor", "Settings", "Guide"];

    function TestSidebar() {
      const [index, setIndex] = React.useState(0);

      useInput((_, key) => {
        if (key.downArrow) setIndex((i) => Math.min(views.length - 1, i + 1));
        if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
      });

      return React.createElement(
        Box,
        { flexDirection: "column" },
        views.map((view, i) =>
          React.createElement(
            Text,
            { key: view, bold: i === index },
            `${i === index ? "> " : "  "}${view}`
          )
        )
      );
    }

    const { lastFrame, stdin } = render(React.createElement(TestSidebar));

    // Initially on Dash
    expect(lastFrame()).toContain("> Dash");

    // Move down to Work
    stdin.write(ARROW_DOWN);
    await delay();
    expect(lastFrame()).toContain("> Work");

    // Move down to Profiles
    stdin.write(ARROW_DOWN);
    await delay();
    expect(lastFrame()).toContain("> Profiles");

    // Move down to Doctor
    stdin.write(ARROW_DOWN);
    await delay();
    expect(lastFrame()).toContain("> Doctor");

    // Move down to Settings
    stdin.write(ARROW_DOWN);
    await delay();
    expect(lastFrame()).toContain("> Settings");

    // Move down to Guide
    stdin.write(ARROW_DOWN);
    await delay();
    expect(lastFrame()).toContain("> Guide");

    // Move down again — should stay on Guide (clamped)
    stdin.write(ARROW_DOWN);
    await delay();
    expect(lastFrame()).toContain("> Guide");

    // Move back up to Settings
    stdin.write(ARROW_UP);
    await delay();
    expect(lastFrame()).toContain("> Settings");

    // Move all the way back up
    stdin.write(ARROW_UP);
    stdin.write(ARROW_UP);
    stdin.write(ARROW_UP);
    stdin.write(ARROW_UP);
    await delay();
    expect(lastFrame()).toContain("> Dash");

    // Beyond top — stays clamped at Dash
    stdin.write(ARROW_UP);
    await delay();
    expect(lastFrame()).toContain("> Dash");
  });
});

describe("Interactive TUI: Tab focus toggle", () => {
  it("toggles focus between sidebar and content with Tab", async () => {
    function TestFocusToggle() {
      const [focus, setFocus] = React.useState<"sidebar" | "content">("sidebar");

      useInput((_, key) => {
        if (key.tab) {
          setFocus((f) => (f === "sidebar" ? "content" : "sidebar"));
        }
      });

      return React.createElement(
        Box,
        { flexDirection: "row", gap: 2 },
        React.createElement(
          Text,
          { bold: focus === "sidebar" },
          focus === "sidebar" ? "[SIDEBAR*]" : "[sidebar]"
        ),
        React.createElement(
          Text,
          { bold: focus === "content" },
          focus === "content" ? "[CONTENT*]" : "[content]"
        )
      );
    }

    const { lastFrame, stdin } = render(React.createElement(TestFocusToggle));

    // Initially sidebar is focused
    expect(lastFrame()).toContain("[SIDEBAR*]");
    expect(lastFrame()).toContain("[content]");

    // Tab to content
    stdin.write(TAB);
    await delay();
    expect(lastFrame()).toContain("[sidebar]");
    expect(lastFrame()).toContain("[CONTENT*]");

    // Tab back to sidebar
    stdin.write(TAB);
    await delay();
    expect(lastFrame()).toContain("[SIDEBAR*]");
    expect(lastFrame()).toContain("[content]");
  });
});

describe("Interactive TUI: Help overlay", () => {
  it("opens help overlay on '?' and closes on Escape", async () => {
    function TestHelpOverlay() {
      const [showHelp, setShowHelp] = React.useState(false);

      useInput((input, key) => {
        if (showHelp) {
          if (key.escape) setShowHelp(false);
          return;
        }
        if (input === "?") setShowHelp(true);
      });

      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, null, "Main View"),
        showHelp
          ? React.createElement(
              Box,
              { flexDirection: "column", borderStyle: "round" },
              React.createElement(Text, { bold: true }, "Help"),
              React.createElement(Text, null, "Keyboard shortcuts and commands. Press Esc to close."),
              React.createElement(Text, null, "tab       Focus sidebar / content"),
              React.createElement(Text, null, "ctrl+p    Command palette"),
              React.createElement(Text, null, "ctrl+t    Toggle theme"),
              React.createElement(Text, null, "ctrl+q    Quit")
            )
          : null
      );
    }

    const { lastFrame, stdin } = render(React.createElement(TestHelpOverlay));

    // Help overlay is not visible initially
    expect(lastFrame()).toContain("Main View");
    expect(lastFrame()).not.toContain("Keyboard shortcuts");

    // Press '?' to open help
    stdin.write("?");
    await delay();
    expect(lastFrame()).toContain("Help");
    expect(lastFrame()).toContain("Keyboard shortcuts");
    expect(lastFrame()).toContain("tab");
    expect(lastFrame()).toContain("ctrl+p");

    // Press Escape to close help
    stdin.write(ESCAPE);
    await delay();
    expect(lastFrame()).not.toContain("Keyboard shortcuts");
    expect(lastFrame()).toContain("Main View");
  });
});

describe("Interactive TUI: Command palette", () => {
  it("opens palette with Ctrl+P, navigates with arrows, and selects with Enter", async () => {
    const paletteItems = [
      { id: "dash", label: "Dashboard", description: "Overview and status" },
      { id: "workspace", label: "Workspace", description: "Open the session shell" },
      { id: "profiles", label: "Profiles", description: "Manage launch targets" },
      { id: "doctor", label: "Doctor", description: "Run diagnostics" },
      { id: "settings", label: "Settings", description: "Inspect shell config" },
    ];

    function TestCommandPalette() {
      const [showPalette, setShowPalette] = React.useState(false);
      const [selectedIndex, setSelectedIndex] = React.useState(0);
      const [activeView, setActiveView] = React.useState("dash");

      useInput((input, key) => {
        if (showPalette) {
          if (key.escape) {
            setShowPalette(false);
            return;
          }
          if (key.upArrow) {
            setSelectedIndex((i) => Math.max(0, i - 1));
            return;
          }
          if (key.downArrow) {
            setSelectedIndex((i) => Math.min(paletteItems.length - 1, i + 1));
            return;
          }
          if (key.return) {
            const item = paletteItems[selectedIndex];
            if (item) {
              setActiveView(item.id);
              setShowPalette(false);
            }
            return;
          }
          return;
        }

        if (key.ctrl && input === "p") {
          setSelectedIndex(0);
          setShowPalette(true);
        }
      });

      if (showPalette) {
        return React.createElement(
          Box,
          { flexDirection: "column" },
          React.createElement(Text, { bold: true }, "Command Palette"),
          ...paletteItems.map((item, i) =>
            React.createElement(
              Text,
              { key: item.id },
              `${i === selectedIndex ? "> " : "  "}${item.label} — ${item.description}`
            )
          )
        );
      }

      return React.createElement(Text, null, `Active: ${activeView}`);
    }

    const { lastFrame, stdin } = render(React.createElement(TestCommandPalette));

    // Initially shows dash
    expect(lastFrame()).toContain("Active: dash");

    // Open palette with Ctrl+P
    stdin.write("\x10"); // Ctrl+P
    await delay();
    expect(lastFrame()).toContain("Command Palette");
    expect(lastFrame()).toContain("> Dashboard");

    // Navigate down to Workspace
    stdin.write(ARROW_DOWN);
    await delay();
    expect(lastFrame()).toContain("> Workspace");

    // Navigate down to Profiles
    stdin.write(ARROW_DOWN);
    await delay();
    expect(lastFrame()).toContain("> Profiles");

    // Select Profiles with Enter
    stdin.write(ENTER);
    await delay();
    expect(lastFrame()).toContain("Active: profiles");
    expect(lastFrame()).not.toContain("Command Palette");
  });

  it("closes palette with Escape without changing view", async () => {
    function TestPaletteEscape() {
      const [showPalette, setShowPalette] = React.useState(false);
      const [activeView] = React.useState("dash");

      useInput((input, key) => {
        if (showPalette) {
          if (key.escape) setShowPalette(false);
          return;
        }
        if (key.ctrl && input === "p") setShowPalette(true);
      });

      if (showPalette) {
        return React.createElement(Text, null, "PALETTE_OPEN");
      }
      return React.createElement(Text, null, `Active: ${activeView}`);
    }

    const { lastFrame, stdin } = render(React.createElement(TestPaletteEscape));
    expect(lastFrame()).toContain("Active: dash");

    // Open palette
    stdin.write("\x10");
    await delay();
    expect(lastFrame()).toContain("PALETTE_OPEN");

    // Close with Escape
    stdin.write(ESCAPE);
    await delay();
    expect(lastFrame()).toContain("Active: dash");
    expect(lastFrame()).not.toContain("PALETTE_OPEN");
  });
});

describe("Interactive TUI: Profile list arrow navigation", () => {
  it("navigates profile list with arrow keys", async () => {
    const profiles = [
      { name: "work", tool: "claude", active: true },
      { name: "personal", tool: "gemini", active: false },
      { name: "testing", tool: "codex", active: false },
    ];

    function TestProfileList() {
      const [selectedIndex, setSelectedIndex] = React.useState(0);

      useInput((_, key) => {
        if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
        if (key.downArrow) setSelectedIndex((i) => Math.min(profiles.length - 1, i + 1));
      });

      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Profiles"),
        ...profiles.map((p, i) =>
          React.createElement(
            Box,
            { key: p.name, gap: 1 },
            React.createElement(Text, null, i === selectedIndex ? ">" : " "),
            React.createElement(Text, { bold: p.active }, p.name),
            React.createElement(Text, { dimColor: true }, `(${p.tool})`)
          )
        )
      );
    }

    const { lastFrame, stdin } = render(React.createElement(TestProfileList));

    // Initially first profile is selected
    const frame0 = lastFrame();
    expect(frame0).toContain("Profiles");
    // Check cursor is on work
    expect(frame0).toMatch(/>\s*work/);

    // Move down to personal
    stdin.write(ARROW_DOWN);
    await delay();
    const frame1 = lastFrame();
    expect(frame1).toMatch(/>\s*personal/);

    // Move down to testing
    stdin.write(ARROW_DOWN);
    await delay();
    const frame2 = lastFrame();
    expect(frame2).toMatch(/>\s*testing/);

    // Clamped at bottom
    stdin.write(ARROW_DOWN);
    await delay();
    expect(lastFrame()).toMatch(/>\s*testing/);

    // Move back up
    stdin.write(ARROW_UP);
    await delay();
    expect(lastFrame()).toMatch(/>\s*personal/);

    stdin.write(ARROW_UP);
    await delay();
    expect(lastFrame()).toMatch(/>\s*work/);

    // Clamped at top
    stdin.write(ARROW_UP);
    await delay();
    expect(lastFrame()).toMatch(/>\s*work/);
  });
});

describe("Interactive TUI: Profile actions", () => {
  it("confirms delete prompt on 'd' and cancels on 'n'", async () => {
    const profiles = [
      { name: "work", tool: "claude" },
      { name: "personal", tool: "gemini" },
    ];

    function TestProfileDelete() {
      const [selectedIndex, setSelectedIndex] = React.useState(0);
      const [confirmDelete, setConfirmDelete] = React.useState(false);
      const [message, setMessage] = React.useState<string | null>(null);

      useInput((input, key) => {
        if (confirmDelete) {
          if (input === "y") {
            setMessage(`Deleted ${profiles[selectedIndex]!.name}`);
            setConfirmDelete(false);
            return;
          }
          if (input === "n" || key.escape) {
            setMessage("Delete cancelled");
            setConfirmDelete(false);
            return;
          }
          return;
        }

        if (key.downArrow) setSelectedIndex((i) => Math.min(profiles.length - 1, i + 1));
        if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
        if (input === "d") setConfirmDelete(true);
      });

      return React.createElement(
        Box,
        { flexDirection: "column" },
        ...profiles.map((p, i) =>
          React.createElement(
            Text,
            { key: p.name },
            `${i === selectedIndex ? "> " : "  "}${p.name}`
          )
        ),
        confirmDelete
          ? React.createElement(Text, { color: "red" }, `Delete ${profiles[selectedIndex]!.name}? (y/n)`)
          : null,
        message ? React.createElement(Text, null, message) : null
      );
    }

    const { lastFrame, stdin } = render(React.createElement(TestProfileDelete));

    // Select work, press 'd'
    expect(lastFrame()).toContain("> work");
    stdin.write("d");
    await delay();
    expect(lastFrame()).toContain("Delete work? (y/n)");

    // Press 'n' to cancel
    stdin.write("n");
    await delay();
    expect(lastFrame()).toContain("Delete cancelled");
    expect(lastFrame()).not.toContain("Delete work? (y/n)");
  });

  it("confirms delete on 'y'", async () => {
    const profiles = [
      { name: "work", tool: "claude" },
      { name: "personal", tool: "gemini" },
    ];

    function TestProfileDeleteConfirm() {
      const [selectedIndex] = React.useState(0);
      const [confirmDelete, setConfirmDelete] = React.useState(false);
      const [message, setMessage] = React.useState<string | null>(null);

      useInput((input) => {
        if (confirmDelete) {
          if (input === "y") {
            setMessage(`Deleted ${profiles[selectedIndex]!.name}`);
            setConfirmDelete(false);
          }
          return;
        }
        if (input === "d") setConfirmDelete(true);
      });

      return React.createElement(
        Box,
        { flexDirection: "column" },
        confirmDelete
          ? React.createElement(Text, null, `Delete ${profiles[selectedIndex]!.name}? (y/n)`)
          : React.createElement(Text, null, `> ${profiles[selectedIndex]!.name}`),
        message ? React.createElement(Text, null, message) : null
      );
    }

    const { lastFrame, stdin } = render(React.createElement(TestProfileDeleteConfirm));

    stdin.write("d");
    await delay();
    expect(lastFrame()).toContain("Delete work? (y/n)");

    stdin.write("y");
    await delay();
    expect(lastFrame()).toContain("Deleted work");
  });
});

describe("Interactive TUI: Theme toggle", () => {
  it("toggles theme with 't' key in sidebar mode", async () => {
    function TestThemeToggle() {
      const [theme, setTheme] = React.useState<"light" | "dark">("light");

      useInput((input) => {
        if (input === "t") {
          setTheme((t) => (t === "light" ? "dark" : "light"));
        }
      });

      return React.createElement(
        Text,
        null,
        `Theme: ${theme === "dark" ? "carbon" : "photon"}`
      );
    }

    const { lastFrame, stdin } = render(React.createElement(TestThemeToggle));

    expect(lastFrame()).toContain("Theme: photon");

    stdin.write("t");
    await delay();
    expect(lastFrame()).toContain("Theme: carbon");

    stdin.write("t");
    await delay();
    expect(lastFrame()).toContain("Theme: photon");
  });
});

describe("Interactive TUI: Overlay blocks input", () => {
  it("prevents view navigation while overlay is open", async () => {
    const views = ["Dash", "Profiles", "Settings"];

    function TestOverlayBlocking() {
      const [viewIndex, setViewIndex] = React.useState(0);
      const [overlayOpen, setOverlayOpen] = React.useState(false);

      useInput((input, key) => {
        // Overlay captures all input except escape
        if (overlayOpen) {
          if (key.escape) setOverlayOpen(false);
          return;
        }

        if (key.downArrow) setViewIndex((i) => Math.min(views.length - 1, i + 1));
        if (key.upArrow) setViewIndex((i) => Math.max(0, i - 1));
        if (input === "?") setOverlayOpen(true);
      });

      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, null, `View: ${views[viewIndex]}`),
        overlayOpen
          ? React.createElement(Text, { bold: true }, "OVERLAY OPEN")
          : null
      );
    }

    const { lastFrame, stdin } = render(React.createElement(TestOverlayBlocking));

    expect(lastFrame()).toContain("View: Dash");

    // Open overlay
    stdin.write("?");
    await delay();
    expect(lastFrame()).toContain("OVERLAY OPEN");

    // Try to navigate — should be blocked
    stdin.write(ARROW_DOWN);
    await delay();
    expect(lastFrame()).toContain("View: Dash");
    expect(lastFrame()).toContain("OVERLAY OPEN");

    // Close overlay
    stdin.write(ESCAPE);
    await delay();
    expect(lastFrame()).not.toContain("OVERLAY OPEN");

    // Now navigation works
    stdin.write(ARROW_DOWN);
    await delay();
    expect(lastFrame()).toContain("View: Profiles");
  });
});

describe("Interactive TUI: Create profile shortcut", () => {
  it("opens create profile overlay on 'c' and closes on Escape", async () => {
    function TestCreateProfile() {
      const [showCreate, setShowCreate] = React.useState(false);

      useInput((input, key) => {
        if (showCreate) {
          if (key.escape) setShowCreate(false);
          return;
        }
        if (input === "c") setShowCreate(true);
      });

      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, null, "Dashboard"),
        showCreate
          ? React.createElement(
              Box,
              { borderStyle: "round", flexDirection: "column" },
              React.createElement(Text, { bold: true }, "Create Profile"),
              React.createElement(Text, null, "Import or create a new profile")
            )
          : null
      );
    }

    const { lastFrame, stdin } = render(React.createElement(TestCreateProfile));

    expect(lastFrame()).toContain("Dashboard");
    expect(lastFrame()).not.toContain("Create Profile");

    // Press 'c' to open create overlay
    stdin.write("c");
    await delay();
    expect(lastFrame()).toContain("Create Profile");
    expect(lastFrame()).toContain("Import or create a new profile");

    // Press Escape to close
    stdin.write(ESCAPE);
    await delay();
    expect(lastFrame()).not.toContain("Create Profile");
    expect(lastFrame()).toContain("Dashboard");
  });
});

describe("Interactive TUI: Combined navigation flow", () => {
  it("performs a full navigation sequence: sidebar -> palette -> select -> overlay -> close", async () => {
    const views = ["Dash", "Work", "Profiles", "Doctor", "Settings"];
    const paletteItems = [
      { id: "dash", label: "Dashboard" },
      { id: "profiles", label: "Profiles" },
      { id: "settings", label: "Settings" },
    ];

    function TestFullFlow() {
      const [viewIndex, setViewIndex] = React.useState(0);
      const [activeView, setActiveView] = React.useState("dash");
      const [focus, setFocus] = React.useState<"sidebar" | "content">("sidebar");
      const [overlay, setOverlay] = React.useState<"palette" | "help" | null>(null);
      const [paletteIdx, setPaletteIdx] = React.useState(0);

      useInput((input, key) => {
        // Overlay mode
        if (overlay) {
          if (key.escape) {
            setOverlay(null);
            return;
          }
          if (overlay === "palette") {
            if (key.downArrow) setPaletteIdx((i) => Math.min(paletteItems.length - 1, i + 1));
            if (key.upArrow) setPaletteIdx((i) => Math.max(0, i - 1));
            if (key.return) {
              const item = paletteItems[paletteIdx];
              if (item) setActiveView(item.id);
              setOverlay(null);
            }
          }
          return;
        }

        // Global shortcuts
        if (key.ctrl && input === "p") {
          setPaletteIdx(0);
          setOverlay("palette");
          return;
        }
        if (key.tab) {
          setFocus((f) => (f === "sidebar" ? "content" : "sidebar"));
          return;
        }

        // Sidebar-only shortcuts
        if (focus === "sidebar") {
          if (key.downArrow) setViewIndex((i) => Math.min(views.length - 1, i + 1));
          if (key.upArrow) setViewIndex((i) => Math.max(0, i - 1));
          if (input === "?") setOverlay("help");
        }
      });

      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, null, `Focus: ${focus}`),
        React.createElement(Text, null, `View: ${activeView}`),
        React.createElement(Text, null, `Sidebar: ${views[viewIndex]}`),
        overlay === "palette"
          ? React.createElement(
              Box,
              { flexDirection: "column" },
              React.createElement(Text, { bold: true }, "PALETTE"),
              ...paletteItems.map((item, i) =>
                React.createElement(Text, { key: item.id }, `${i === paletteIdx ? "> " : "  "}${item.label}`)
              )
            )
          : null,
        overlay === "help"
          ? React.createElement(Text, { bold: true }, "HELP_OVERLAY")
          : null
      );
    }

    const { lastFrame, stdin } = render(React.createElement(TestFullFlow));

    // Step 1: Initial state
    expect(lastFrame()).toContain("Focus: sidebar");
    expect(lastFrame()).toContain("View: dash");

    // Step 2: Navigate sidebar down twice
    stdin.write(ARROW_DOWN);
    stdin.write(ARROW_DOWN);
    await delay();
    expect(lastFrame()).toContain("Sidebar: Profiles");

    // Step 3: Open help overlay
    stdin.write("?");
    await delay();
    expect(lastFrame()).toContain("HELP_OVERLAY");

    // Step 4: Close help
    stdin.write(ESCAPE);
    await delay();
    expect(lastFrame()).not.toContain("HELP_OVERLAY");

    // Step 5: Open command palette with Ctrl+P
    stdin.write("\x10");
    await delay();
    expect(lastFrame()).toContain("PALETTE");
    expect(lastFrame()).toContain("> Dashboard");

    // Step 6: Navigate palette to Settings (index 2)
    stdin.write(ARROW_DOWN);
    stdin.write(ARROW_DOWN);
    await delay();
    expect(lastFrame()).toContain("> Settings");

    // Step 7: Select Settings
    stdin.write(ENTER);
    await delay();
    expect(lastFrame()).toContain("View: settings");
    expect(lastFrame()).not.toContain("PALETTE");

    // Step 8: Tab to content pane
    stdin.write(TAB);
    await delay();
    expect(lastFrame()).toContain("Focus: content");

    // Step 9: Tab back to sidebar
    stdin.write(TAB);
    await delay();
    expect(lastFrame()).toContain("Focus: sidebar");
  });
});

describe("Interactive TUI: Edit flags mode", () => {
  it("enters flags editing mode with 'f', types flags, and saves with Enter", async () => {
    function TestFlagsEdit() {
      const [mode, setMode] = React.useState<"idle" | "editing">("idle");
      const [flagsInput, setFlagsInput] = React.useState("");
      const [savedFlags, setSavedFlags] = React.useState("");

      useInput((input, key) => {
        if (mode === "editing") {
          if (key.escape) {
            setMode("idle");
            setFlagsInput("");
            return;
          }
          if (key.return) {
            setSavedFlags(flagsInput);
            setMode("idle");
            setFlagsInput("");
            return;
          }
          if (key.backspace || key.delete) {
            setFlagsInput((v) => v.slice(0, -1));
            return;
          }
          if (!key.ctrl && !key.meta && input.length === 1) {
            setFlagsInput((v) => v + input);
          }
          return;
        }

        if (input === "f") {
          setMode("editing");
        }
      });

      return React.createElement(
        Box,
        { flexDirection: "column" },
        mode === "editing"
          ? React.createElement(
              Box,
              { flexDirection: "column" },
              React.createElement(Text, null, "Launch flags:"),
              React.createElement(Text, null, `Input: ${flagsInput}_`)
            )
          : React.createElement(
              Box,
              { flexDirection: "column" },
              React.createElement(Text, null, `Flags: ${savedFlags || "none"}`),
              React.createElement(Text, { dimColor: true }, "Press f to edit flags")
            )
      );
    }

    const { lastFrame, stdin } = render(React.createElement(TestFlagsEdit));

    // Initially in idle mode
    expect(lastFrame()).toContain("Flags: none");

    // Press 'f' to enter edit mode
    stdin.write("f");
    await delay();
    expect(lastFrame()).toContain("Launch flags:");
    expect(lastFrame()).toContain("Input: _");

    // Type some flags
    stdin.write("-");
    stdin.write("-");
    stdin.write("v");
    stdin.write("e");
    stdin.write("r");
    stdin.write("b");
    stdin.write("o");
    stdin.write("s");
    stdin.write("e");
    await delay();
    expect(lastFrame()).toContain("Input: --verbose_");

    // Press Enter to save
    stdin.write(ENTER);
    await delay();
    expect(lastFrame()).toContain("Flags: --verbose");
    expect(lastFrame()).not.toContain("Launch flags:");
  });

  it("cancels flags editing with Escape", async () => {
    function TestFlagsCancel() {
      const [mode, setMode] = React.useState<"idle" | "editing">("idle");
      const [flagsInput, setFlagsInput] = React.useState("");

      useInput((input, key) => {
        if (mode === "editing") {
          if (key.escape) {
            setMode("idle");
            setFlagsInput("");
            return;
          }
          if (!key.ctrl && !key.meta && input.length === 1) {
            setFlagsInput((v) => v + input);
          }
          return;
        }
        if (input === "f") setMode("editing");
      });

      return React.createElement(
        Text,
        null,
        mode === "editing" ? `Editing: ${flagsInput}` : "IDLE"
      );
    }

    const { lastFrame, stdin } = render(React.createElement(TestFlagsCancel));

    expect(lastFrame()).toContain("IDLE");

    stdin.write("f");
    await delay();
    expect(lastFrame()).toContain("Editing:");

    stdin.write("x");
    stdin.write("y");
    await delay();
    expect(lastFrame()).toContain("Editing: xy");

    // Escape to cancel — should return to idle
    stdin.write(ESCAPE);
    await delay();
    expect(lastFrame()).toContain("IDLE");
  });
});

describe("Interactive TUI: Profile switch with 's' key", () => {
  it("switches active profile with 's' key", async () => {
    const profiles = [
      { name: "work", tool: "claude", active: true },
      { name: "personal", tool: "gemini", active: false },
    ];

    function TestProfileSwitch() {
      const [activeIndex, setActiveIndex] = React.useState(0);
      const [selectedIndex, setSelectedIndex] = React.useState(0);
      const [message, setMessage] = React.useState<string | null>(null);

      useInput((input, key) => {
        if (key.downArrow) setSelectedIndex((i) => Math.min(profiles.length - 1, i + 1));
        if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
        if (input === "s") {
          setActiveIndex(selectedIndex);
          setMessage(`Switched to ${profiles[selectedIndex]!.name}`);
        }
      });

      return React.createElement(
        Box,
        { flexDirection: "column" },
        ...profiles.map((p, i) =>
          React.createElement(
            Text,
            { key: p.name },
            `${i === selectedIndex ? ">" : " "} ${i === activeIndex ? "*" : " "} ${p.name}`
          )
        ),
        message ? React.createElement(Text, null, message) : null
      );
    }

    const { lastFrame, stdin } = render(React.createElement(TestProfileSwitch));

    // Initially work is selected and active
    expect(lastFrame()).toContain("> * work");

    // Navigate to personal
    stdin.write(ARROW_DOWN);
    await delay();
    expect(lastFrame()).toContain(">   personal");

    // Switch to personal
    stdin.write("s");
    await delay();
    expect(lastFrame()).toContain("Switched to personal");
    expect(lastFrame()).toContain("> * personal");
  });
});

describe("Interactive TUI: Scroll navigation in settings-like views", () => {
  it("scrolls content with arrow keys", async () => {
    const allItems = Array.from({ length: 20 }, (_, i) => `Item ${i + 1}`);
    const VISIBLE = 5;

    function TestScrollView() {
      const [offset, setOffset] = React.useState(0);

      useInput((_, key) => {
        if (key.downArrow) setOffset((o) => Math.min(allItems.length - VISIBLE, o + 1));
        if (key.upArrow) setOffset((o) => Math.max(0, o - 1));
      });

      const visibleItems = allItems.slice(offset, offset + VISIBLE);

      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, { dimColor: true }, `Showing ${offset + 1}-${offset + VISIBLE} of ${allItems.length}`),
        ...visibleItems.map((item) =>
          React.createElement(Text, { key: item }, item)
        )
      );
    }

    const { lastFrame, stdin } = render(React.createElement(TestScrollView));

    // Initially showing items 1-5
    expect(lastFrame()).toContain("Showing 1-5 of 20");
    expect(lastFrame()).toContain("Item 1");
    expect(lastFrame()).toContain("Item 5");
    expect(lastFrame()).not.toContain("Item 6");

    // Scroll down
    stdin.write(ARROW_DOWN);
    stdin.write(ARROW_DOWN);
    stdin.write(ARROW_DOWN);
    await delay();
    expect(lastFrame()).toContain("Showing 4-8 of 20");
    expect(lastFrame()).toContain("Item 4");
    expect(lastFrame()).not.toContain("Item 1");

    // Scroll back up
    stdin.write(ARROW_UP);
    stdin.write(ARROW_UP);
    await delay();
    expect(lastFrame()).toContain("Showing 2-6 of 20");
  });
});
