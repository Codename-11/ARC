import { withFullScreen } from "fullscreen-ink";
import { ThemeProvider } from "./theme.js";
import { Dashboard } from "./Dashboard.js";

export function renderDashboard(): void {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "arc dashboard requires an interactive terminal.\n" +
        "Use `arc status` for non-interactive output.\n"
    );
    process.exitCode = 1;
    return;
  }

  const app = withFullScreen(
    <ThemeProvider>
      <Dashboard />
    </ThemeProvider>
  );

  app.start();
}
