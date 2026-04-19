import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { app, BrowserWindow, Menu, Tray, nativeImage } from "electron";
import { startDaemon, type DaemonHandle } from "@axiom-labs/arc-daemon";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let daemon: Pick<DaemonHandle, "config" | "stop"> | null = null;
let quitting = false;

// Hard-coded to avoid pulling in the CLI package (which would drag the whole
// TUI into the Electron bundle). Packaged builds can stamp ARC_VERSION.
const VERSION: string = process.env["ARC_VERSION"] ?? "1.0.0-alpha.0";

const DAEMON_HOST = "127.0.0.1";
const DAEMON_PORT = 7272;
const DAEMON_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}/`;
const DAEMON_HEALTH_URL = `${DAEMON_URL}health`;
const DEV_DASHBOARD_FALLBACK = "http://127.0.0.1:3700/";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRELOAD_PATH = path.join(__dirname, "preload.js");
const TRAY_ICON_PATH = path.join(__dirname, "..", "assets", "tray.png");

async function ensureDaemon(): Promise<void> {
  try {
    daemon = await startDaemon({ version: VERSION });
  } catch (err) {
    // If another ARC process already owns the daemon that's fine — we just
    // won't be the one to stop it on quit.
    if (/already running/i.test((err as Error).message ?? "")) {
      daemon = null;
      return;
    }
    throw err;
  }
}

/** HEAD-ish GET probe: resolves true when the URL answers <500 within timeoutMs. */
function probeUrl(url: string, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForHealth(timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeUrl(DAEMON_HEALTH_URL)) return true;
    await sleep(100);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());
  // Hide instead of destroying so the tray can re-open this window.
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });

  return win;
}

async function loadDashboard(win: BrowserWindow): Promise<void> {
  // TODO(Unit 4): once the daemon serves dashboard assets at `/`, drop the
  // :3700 fallback. Until then `/` returns 404 and we prefer the dev server
  // when it's reachable.
  await waitForHealth();
  const fallbackReachable = await probeUrl(DEV_DASHBOARD_FALLBACK);
  await win.loadURL(fallbackReachable ? DEV_DASHBOARD_FALLBACK : DAEMON_URL);
}

function showOrCreateWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = createWindow();
  void loadDashboard(mainWindow);
}

function setupTray(): void {
  // nativeImage tolerates a missing/empty icon — falls back to a blank tray.
  const image = nativeImage.createFromPath(TRAY_ICON_PATH);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip("ARC");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show ARC", click: showOrCreateWindow },
      { label: "Hide ARC", click: () => mainWindow?.hide() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else showOrCreateWindow();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      await ensureDaemon();
    } catch (err) {
      // Non-fatal: the window still loads so the user sees a useful error
      // message from the dashboard (or the daemon's 404).
      console.error("[arc-desktop] failed to start daemon:", err);
    }

    mainWindow = createWindow();
    await loadDashboard(mainWindow);
    setupTray();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) showOrCreateWindow();
    });
  });

  app.on("before-quit", async (event) => {
    if (!daemon) return;
    event.preventDefault();
    const handle = daemon;
    daemon = null;
    try {
      await handle.stop();
    } catch (err) {
      console.error("[arc-desktop] daemon stop failed:", err);
    } finally {
      quitting = true;
      app.quit();
    }
  });

  // Intentionally empty: we keep the tray alive after the last window closes.
  app.on("window-all-closed", () => {});
}
