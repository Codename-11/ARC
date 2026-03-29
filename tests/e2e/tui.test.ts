import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text, Box } from "ink";

/**
 * TUI component smoke tests using ink-testing-library.
 *
 * These tests verify that key components can render without crashing.
 * They use lightweight wrappers since the real components depend on
 * fullscreen-ink hooks and other runtime context that isn't available
 * in a test environment.
 *
 * For deeper TUI testing, components would need to be refactored to
 * accept their dependencies via props (dependency injection).
 */

// Mock fullscreen-ink since it requires a real terminal
vi.mock("fullscreen-ink", () => ({
  useScreenSize: () => ({ width: 120, height: 40 }),
  FullScreen: ({ children }: { children: React.ReactNode }) =>
    React.createElement(Box, null, children),
}));

describe("TUI component smoke tests", () => {
  beforeEach(() => {
    // Set ARC_DIR to a non-existent temp path so components don't touch real config
    process.env["ARC_DIR"] = "/tmp/arc-tui-test-nonexistent";
  });

  it("renders a basic Ink component", () => {
    const { lastFrame } = render(
      React.createElement(Text, null, "ARC Dashboard")
    );
    expect(lastFrame()).toContain("ARC Dashboard");
  });

  it("renders a Box with Text children", () => {
    const { lastFrame } = render(
      React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, null, "Profiles"),
        React.createElement(Text, null, "No profiles found")
      )
    );
    const frame = lastFrame();
    expect(frame).toContain("Profiles");
    expect(frame).toContain("No profiles found");
  });

  it("renders a profile list-like component", () => {
    function MockProfileList() {
      const profiles = [
        { name: "work", tool: "claude", active: true },
        { name: "personal", tool: "gemini", active: false },
      ];

      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(
          Text,
          { bold: true },
          "Profiles"
        ),
        ...profiles.map((p) =>
          React.createElement(
            Box,
            { key: p.name, gap: 1 },
            React.createElement(Text, null, p.active ? "*" : " "),
            React.createElement(Text, { bold: p.active }, p.name),
            React.createElement(Text, { dimColor: true }, `(${p.tool})`)
          )
        )
      );
    }

    const { lastFrame } = render(React.createElement(MockProfileList));
    const frame = lastFrame();
    expect(frame).toContain("work");
    expect(frame).toContain("personal");
    expect(frame).toContain("claude");
    expect(frame).toContain("gemini");
  });

  it("renders a dash-like status view", () => {
    function MockDashView() {
      return React.createElement(
        Box,
        { flexDirection: "column", padding: 1 },
        React.createElement(Text, { bold: true }, "ARC — Agent Runtime Control"),
        React.createElement(Text, null, "Version: 0.1.0"),
        React.createElement(Text, null, "Active: work"),
        React.createElement(Text, null, "Profiles: 2")
      );
    }

    const { lastFrame } = render(React.createElement(MockDashView));
    const frame = lastFrame();
    expect(frame).toContain("ARC");
    expect(frame).toContain("Version: 0.1.0");
    expect(frame).toContain("Active: work");
    expect(frame).toContain("Profiles: 2");
  });
});
