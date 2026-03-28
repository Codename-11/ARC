#!/usr/bin/env node

/**
 * ARC — Local Development Uninstall
 *
 * Removes shims and PATH entry created by install-local.js.
 * Does NOT remove ~/.arc/ config or keyring entries — use `pnpm teardown`
 * (the full uninstaller) for a complete teardown.
 *
 * Usage:  pnpm uninstall:local
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const userBinDir =
  process.env["ARC_LOCAL_BIN_DIR"] ||
  path.join(os.homedir(), ".local", "bin");
const installMetaPath = path.join(userBinDir, ".arc-install.json");

// ── Helpers ──────────────────────────────────────────────────────────────────

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

function step(label) {
  process.stdout.write(`  ${cyan("\u25B6")} ${label} `);
}

function ok(detail) {
  console.log(green("\u2714") + (detail ? ` ${dim(detail)}` : ""));
}

function skip(detail) {
  console.log(yellow("\u2013") + (detail ? ` ${dim(detail)}` : ""));
}

// ── Read install metadata ────────────────────────────────────────────────────

let meta = null;
if (fs.existsSync(installMetaPath)) {
  try {
    meta = JSON.parse(fs.readFileSync(installMetaPath, "utf8"));
  } catch {
    // Malformed — proceed anyway
  }
}

console.log();
console.log(`  ${bold("ARC")} ${dim("— local development uninstall")}`);
console.log();

// ── Remove shims ─────────────────────────────────────────────────────────────

step("Removing shims...");

const shimPaths = [
  path.join(userBinDir, "arc"),
  path.join(userBinDir, "arc.cmd"),
  path.join(userBinDir, "arc.ps1"),
];

let removedCount = 0;
for (const shimPath of shimPaths) {
  if (fs.existsSync(shimPath)) {
    fs.unlinkSync(shimPath);
    removedCount++;
  }
}

if (removedCount > 0) {
  ok(`${removedCount} shim${removedCount > 1 ? "s" : ""} removed`);
} else {
  skip("no shims found");
}

// ── Remove install metadata ──────────────────────────────────────────────────

if (fs.existsSync(installMetaPath)) {
  fs.unlinkSync(installMetaPath);
}

// ── Remove PATH entry (Windows only) ────────────────────────────────────────

if (isWindows && meta?.addedToUserPath) {
  step("Removing from Windows PATH...");

  try {
    const readResult = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "[Environment]::GetEnvironmentVariable('Path','User')",
      ],
      { encoding: "utf8" }
    );

    if (readResult.status !== 0) {
      throw new Error("could not read user PATH");
    }

    const normalize = (p) =>
      path.resolve(p).replaceAll("/", "\\").toLowerCase();

    const currentUserPath = readResult.stdout.trim();
    const nextEntries = currentUserPath
      .split(";")
      .map((e) => e.trim())
      .filter(Boolean)
      .filter((e) => normalize(e) !== normalize(userBinDir));

    const escaped = nextEntries.join(";").replaceAll("'", "''");
    const setResult = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `[Environment]::SetEnvironmentVariable('Path', '${escaped}', 'User')`,
      ],
      { encoding: "utf8" }
    );

    if (setResult.status !== 0) {
      throw new Error("could not update user PATH");
    }

    ok("removed from user PATH");
  } catch (err) {
    console.log(red("\u2716") + ` ${err.message}`);
  }
} else if (isWindows) {
  step("Windows PATH...");
  skip("was not added by installer");
}

// ── Done ─────────────────────────────────────────────────────────────────────

console.log();
if (removedCount > 0) {
  console.log(`  ${green("\u2714")} ${bold("Uninstalled.")} The ${cyan("arc")} command has been removed.`);
} else {
  console.log(`  ${yellow("!")} Nothing to remove — ARC was not installed locally.`);
}

console.log();
console.log(`  ${dim("Your ~/.arc/ config and profiles are untouched.")}`);
console.log(`  ${dim("To remove everything: pnpm teardown")}`);
console.log();
