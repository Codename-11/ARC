import { type ReactNode, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { useTheme } from "../theme.js";
import { ScrollBox, clampOffset } from "../components/ScrollBox.js";
import { VERSION } from "../../version.js";
import { PACKAGE_NAME } from "../../update.js";

interface Props {
  focusedPane: "sidebar" | "content";
  inputEnabled: boolean;
}

export function AboutView({ focusedPane, inputEnabled }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const { height: screenHeight } = useScreenSize();
  const [scrollOffset, setScrollOffset] = useState(0);
  const isActive = focusedPane === "content" && inputEnabled;

  const items: ReactNode[] = [];
  const push = (node: ReactNode) => items.push(<Box key={items.length}>{node}</Box>);
  const blank = () => push(<Text> </Text>);
  const heading = (text: string) => push(
    <Text color={colors.secondary} bold underline>{text}</Text>
  );
  const body = (text: string) => push(
    <Text color={colors.dimmed} wrap="truncate">{text}</Text>
  );
  const cmd = (command: string, desc: string) => push(
    <Box>
      <Box width={30} flexShrink={0}>
        <Text color={colors.primary} bold>  {command}</Text>
      </Box>
      <Text color={colors.dimmed}>{desc}</Text>
    </Box>
  );

  // ── Header ──────────────────────────────────────────────

  push(<Text color={colors.text} bold>ARC v{VERSION} — Agent Runtime Control</Text>);
  body("Unified profile manager for agent CLIs (Claude, Gemini, Codex, and more).");
  body(`Package: ${PACKAGE_NAME}  ·  arc-cli.dev`);
  blank();

  // ── What are Profiles? ──────────────────────────────────

  heading("What are Profiles?");
  body("A profile is an isolated configuration directory for an agent tool.");
  body("Each profile has its own credentials, settings, MCP servers, and");
  body("session history. When you launch a tool with a profile, ARC sets");
  body("CLAUDE_CONFIG_DIR (or equivalent) so the tool reads from that profile.");
  blank();
  body("This means you can have separate configs for work, personal, testing,");
  body("or different auth methods — without them interfering with each other.");
  blank();

  heading("Managing Profiles");
  cmd("arc create <name>", "Create a new empty profile");
  cmd("arc import --all", "Import all detected tool configs");
  cmd("arc use <name>", "Switch the active profile");
  cmd("arc launch <name>", "Launch a tool with a specific profile");
  cmd("arc profile delete <name>", "Delete a profile (with confirmation)");
  blank();
  body("TUI: Press c to create, s to switch, enter to launch, d to delete.");
  blank();

  // ── What gets imported? ─────────────────────────────────

  heading("What gets imported?");
  body("When you import a tool's config (e.g. from ~/.claude/), ARC copies:");
  body("  ✓  Credentials (.credentials.json, oauth_creds.json, auth.json)");
  body("  ✓  Settings (settings.json, config.toml)");
  body("  ✓  MCP server config (.claude.json)");
  body("  ✓  Plugins, skills, custom commands");
  body("  ✓  State files (trusted folders, installation ID)");
  blank();
  body("ARC skips large/ephemeral data to keep imports fast:");
  body("  ✗  Session history, cache, debug logs, telemetry");
  body("  ✗  Extensions with node_modules (Gemini)");
  body("  ✗  SQLite databases, vendor imports (Codex)");
  blank();

  // ── Shared Layer ────────────────────────────────────────

  heading("Shared Layer");
  body("The shared layer lets you define MCP servers, commands, and CLAUDE.md");
  body("once and sync them to any profile. Shared items live in ~/.arc/shared/.");
  blank();

  heading("Setting up the Shared Layer");
  body("The easiest way: push an existing profile's config to shared.");
  blank();
  body("Option A: Push from an existing profile (recommended)");
  cmd("arc shared pull <profile>", "Copy MCPs + cmds to shared");
  body("  TUI: Press H (shift+h) on a profile in Profiles view.");
  body("  Then press h on other profiles to sync from shared.");
  blank();
  body("Option B: Manual setup");
  body("  1. Create ~/.arc/shared/");
  body("  2. Add settings.json with mcpServers");
  body("  3. Optionally add commands/ dir and CLAUDE.md");
  push(<Text color={colors.dimmed}>  {"~/.arc/shared/commands/   — command files synced to profiles"}</Text>);
  push(<Text color={colors.dimmed}>  {"~/.arc/shared/CLAUDE.md   — prepended to profile CLAUDE.md"}</Text>);
  blank();
  heading("Shared Layer Commands");
  cmd("arc shared pull <profile>", "Push profile config to shared");
  cmd("arc shared enable <profile>", "Sync shared config to profile");
  cmd("arc shared disable <profile>", "Remove synced items");
  cmd("arc shared sync", "Re-sync all enabled profiles");
  body("TUI: h = toggle sync, H = push to shared.");
  blank();

  heading("What gets synced?");
  body("  MCP servers  — merged into profile's settings.json (mcpServers key)");
  body("  Commands     — copied from shared/commands/ to profile directory");
  body("  CLAUDE.md    — prepended to profile's CLAUDE.md (opt-in)");
  body("  Memory       — symlinked to shared/memory/ (opt-in)");
  body("  Projects     — symlinked to shared/projects/ (opt-in)");
  blank();

  // ── Credential Hot-Swap ─────────────────────────────────

  heading("Credential Hot-Swap (experimental)");
  body("Hot-swap changes ONLY the auth credentials in the tool's own config");
  body("directory (e.g. ~/.claude/). Unlike profiles, everything else stays:");
  body("MCPs, settings, session history, Claude Desktop — all unchanged.");
  blank();
  body("Use this when you have multiple accounts on the same tool and want");
  body("to switch between them without maintaining separate configs.");
  blank();
  cmd("arc swap capture <name>", "Snapshot current credentials");
  cmd("arc swap to <name>", "Swap to another account");
  cmd("arc swap list", "Show captured accounts");
  cmd("arc swap delete <name>", "Remove a snapshot");
  body("TUI: Open via Command Palette (Ctrl+P) → Swap Credentials.");
  blank();

  heading("Hot-Swap vs Profile Switch");
  push(
    <Box>
      <Box width={20} flexShrink={0}><Text color={colors.dimmed}>  Profile switch:</Text></Box>
      <Text color={colors.dimmed}>Changes entire config dir (isolated)</Text>
    </Box>
  );
  push(
    <Box>
      <Box width={20} flexShrink={0}><Text color={colors.dimmed}>  Hot-swap:</Text></Box>
      <Text color={colors.dimmed}>Changes only credentials (shared config)</Text>
    </Box>
  );
  blank();

  // ── Data Layout ─────────────────────────────────────────

  heading("Data Layout");
  push(<Text color={colors.dimmed}>  {"~/.arc/"}</Text>);
  push(<Text color={colors.dimmed}>  {"  config.json              Profile registry + active profile"}</Text>);
  push(<Text color={colors.dimmed}>  {"  update-check.json        Cached version check (4h TTL)"}</Text>);
  push(<Text color={colors.dimmed}>  {"  profiles/<name>/         Isolated tool config directories"}</Text>);
  push(<Text color={colors.dimmed}>  {"  shared/                  Shared MCP servers, commands, CLAUDE.md"}</Text>);
  push(<Text color={colors.dimmed}>  {"  credentials/<account>/   Hot-swap credential snapshots"}</Text>);
  blank();

  // ── Footer ──────────────────────────────────────────────

  body("Full documentation: docs/ in the repo or arc-cli.dev");

  const contentHeight = Math.max(8, screenHeight - 6);

  useInput((_, key) => {
    if (key.upArrow) setScrollOffset((o) => Math.max(0, o - 1));
    if (key.downArrow) setScrollOffset((o) => clampOffset(o + 1, items.length, contentHeight));
    if (key.pageDown) setScrollOffset((o) => clampOffset(o + 10, items.length, contentHeight));
    if (key.pageUp) setScrollOffset((o) => Math.max(0, o - 10));
  }, { isActive });

  return <ScrollBox items={items} height={contentHeight} offset={scrollOffset} />;
}
