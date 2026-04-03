import { render } from "ink";
import { FullScreenBox } from "fullscreen-ink";
import { ThemeProvider, type ThemeName } from "./theme.js";
import { Dashboard } from "./Dashboard.js";
import { loadConfig, saveConfig } from "../config.js";
import { withLifecycleScope } from "../../../core/src/lifecycle.js";
import { writeLogEvent } from "../log.js";

export let launchPending = false;
export function markLaunchPending(): void {
  launchPending = true;
}

const ALT_BUFFER_ON = "\x1b[?1049h";
const ALT_BUFFER_OFF = "\x1b[?1049l";
const MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1006l\x1b[?1000l";
const CURSOR_SHOW = "\x1b[?25h";

function restoreTerminal(): void {
  try {
    process.stdout.write(MOUSE_OFF + ALT_BUFFER_OFF + CURSOR_SHOW);
  } catch {
    // stdout may already be closed during teardown
  }
  try {
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
  } catch {
    // best effort
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

  const config = loadConfig();
  const initialTheme: ThemeName =
    config.theme === "dark" || config.theme === "light" ? config.theme : "light";

  const handleThemeChange = (name: ThemeName) => {
    const fresh = loadConfig();
    saveConfig({ ...fresh, theme: name });
  };

  await withLifecycleScope({ component: "tui" }, async (scope) => {
    scope.registerCleanup(restoreTerminal);
    process.stdout.write(ALT_BUFFER_ON + MOUSE_ON);
    writeLogEvent({ level: "info", component: "tui", action: "dashboard:start" });

    const instance = render(
      <FullScreenBox>
        <ThemeProvider initialTheme={initialTheme} onThemeChange={handleThemeChange}>
          <Dashboard />
        </ThemeProvider>
      </FullScreenBox>,
      { exitOnCtrlC: false }
    );

    await instance.waitUntilExit();
    restoreTerminal();
    writeLogEvent({ level: "info", component: "tui", action: "dashboard:stop" });
  });

  if (!launchPending) {
    process.exit(0);
  }
}
