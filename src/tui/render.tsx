import { render } from "ink";
import { FullScreenBox } from "fullscreen-ink";
import { ThemeProvider, type ThemeName } from "./theme.js";
import { Dashboard } from "./Dashboard.js";
import { loadConfig, saveConfig } from "../config.js";

/**
 * Set this before triggering exit() when a tool launch follows the TUI teardown.
 * Prevents renderDashboard from calling process.exit(0) while handleLaunch is
 * still setting up the child process.
 */
export let launchPending = false;
export function markLaunchPending(): void {
  launchPending = true;
}

// Terminal escape sequences
const ALT_BUFFER_ON = "\x1b[?1049h";
const ALT_BUFFER_OFF = "\x1b[?1049l";
const MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1006l\x1b[?1000l";
const CURSOR_SHOW = "\x1b[?25h";

/** Synchronously restore the terminal to a clean state. */
function restoreTerminal(): void {
  try {
    process.stdout.write(MOUSE_OFF + ALT_BUFFER_OFF + CURSOR_SHOW);
  } catch {
    // stdout may already be closed during teardown
  }
  // Ensure stdin is out of raw mode so the parent shell works normally
  try {
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
  } catch {
    // stdin may be destroyed
  }
}

export async function renderDashboard(): Promise<void> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "arc dashboard requires an interactive terminal.\n" +
        "Use `arc status` for non-interactive output.\n"
    );
    process.exitCode = 1;
    return;
  }

  // Read persisted theme preference
  const config = loadConfig();
  const initialTheme: ThemeName =
    config.theme === "dark" || config.theme === "light" ? config.theme : "light";

  const handleThemeChange = (name: ThemeName) => {
    const fresh = loadConfig();
    saveConfig({ ...fresh, theme: name });
  };

  // Safety net: restore terminal on any exit path (signals, process.exit(), etc.)
  process.on("exit", restoreTerminal);

  // Enter alternate screen buffer + mouse tracking
  process.stdout.write(ALT_BUFFER_ON + MOUSE_ON);

  // Render with Ink directly — no withFullScreen wrapper.
  // exitOnCtrlC: false prevents Ink from calling process.exit() on Ctrl+C;
  // we handle it ourselves in Dashboard.tsx via exit().
  const instance = render(
    <FullScreenBox>
      <ThemeProvider initialTheme={initialTheme} onThemeChange={handleThemeChange}>
        <Dashboard />
      </ThemeProvider>
    </FullScreenBox>,
    { exitOnCtrlC: false }
  );

  // Block until the TUI exits (user presses q / Ctrl+C / Ctrl+Q)
  await instance.waitUntilExit();

  // Clean up — synchronous writes so they can't lose a race to event loop drain
  process.off("exit", restoreTerminal);
  restoreTerminal();

  // On normal quit (not a tool launch), exit immediately so nothing in Node's
  // shutdown path can corrupt the parent shell's terminal state.
  if (!launchPending) {
    process.exit(0);
  }
}
