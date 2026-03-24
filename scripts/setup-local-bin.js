#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distEntry = path.join(repoRoot, "dist", "index.js");
const isWindows = process.platform === "win32";

if (!fs.existsSync(distEntry)) {
  console.error("dist/index.js not found. Run the build first.");
  process.exit(1);
}

const userBinDir =
  process.env["ARC_LOCAL_BIN_DIR"] ||
  path.join(os.homedir(), ".local", "bin");
const installMetaPath = path.join(userBinDir, ".arc-install.json");

fs.mkdirSync(userBinDir, { recursive: true });

const cmdPath = path.join(userBinDir, "arc.cmd");
const ps1Path = path.join(userBinDir, "arc.ps1");
const shPath = path.join(userBinDir, "arc");

const normalizedDist = distEntry.replaceAll("\\", "\\\\");

fs.writeFileSync(
  cmdPath,
  `@echo off\r\nnode "${distEntry}" %*\r\n`,
  "utf8"
);

fs.writeFileSync(
  ps1Path,
  `node "${normalizedDist}" @args\r\n`,
  "utf8"
);

fs.writeFileSync(
  shPath,
  `#!/usr/bin/env sh\nnode "${distEntry.replaceAll("\\", "/")}" "$@"\n`,
  "utf8"
);

try {
  fs.chmodSync(shPath, 0o755);
} catch {
  // Ignore on filesystems that do not support chmod.
}

function normalizePath(value) {
  return path.resolve(value).replaceAll("/", "\\").toLowerCase();
}

function getWindowsUserPath() {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "[Environment]::GetEnvironmentVariable('Path','User')",
    ],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Failed to read Windows user PATH.");
  }

  return result.stdout.trim();
}

function setWindowsUserPath(value) {
  const escaped = value.replaceAll("'", "''");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `[Environment]::SetEnvironmentVariable('Path', '${escaped}', 'User')`,
    ],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Failed to update Windows user PATH.");
  }
}

let addedToUserPath = false;

if (isWindows) {
  const currentUserPath = getWindowsUserPath();
  const pathEntries = currentUserPath
    ? currentUserPath.split(";").map((entry) => entry.trim()).filter(Boolean)
    : [];
  const hasUserBinDir = pathEntries.some(
    (entry) => normalizePath(entry) === normalizePath(userBinDir)
  );

  if (!hasUserBinDir) {
    pathEntries.push(userBinDir);
    setWindowsUserPath(pathEntries.join(";"));
    addedToUserPath = true;
  }
}

fs.writeFileSync(
  installMetaPath,
  JSON.stringify(
    {
      userBinDir,
      addedToUserPath,
      installedAt: new Date().toISOString(),
    },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(`Created local arc shims in ${userBinDir}`);
if (isWindows) {
  if (addedToUserPath) {
    console.log(`Added ${userBinDir} to your Windows user PATH`);
    console.log("Restart your terminal so PowerShell/cmd can resolve: arc");
  } else {
    console.log("PowerShell/cmd should now resolve: arc");
    console.log("If it is still not found, restart your terminal first.");
  }
} else {
  console.log(
    "If it is still not found, add this directory to PATH: " + userBinDir
  );
}
