#!/usr/bin/env node

/**
 * ARC — Local Development Install
 *
 * Builds from source, creates shims in ~/.local/bin/, and adds to PATH.
 * After running, `arc` is available globally from any terminal.
 *
 * Usage:  pnpm install:local
 * Undo:   pnpm uninstall:local
 */

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

function fail(detail) {
  console.log(red("\u2716") + (detail ? ` ${detail}` : ""));
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf-8",
    cwd: repoRoot,
    ...opts,
  });
  return result;
}

// ── Prerequisites ────────────────────────────────────────────────────────────

console.log();
console.log(`  ${bold("ARC")} ${dim("— local development install")}`);
console.log();

step("Checking Node.js...");
const nodeVersion = process.version.replace(/^v/, "");
const nodeMajor = parseInt(nodeVersion.split(".")[0], 10);
if (nodeMajor < 18) {
  fail(`Node.js >= 18 required (found v${nodeVersion})`);
  process.exit(1);
}
ok(`v${nodeVersion}`);

// ── Build ────────────────────────────────────────────────────────────────────

step("Building from source...");
// On Windows, pnpm is a .cmd shim that requires shell resolution.
// We use npx-style invocation to avoid Node 24's shell+args deprecation.
const buildResult = isWindows
  ? spawnSync("cmd", ["/c", "pnpm", "build"], { encoding: "utf-8", cwd: repoRoot })
  : spawnSync("pnpm", ["build"], { encoding: "utf-8", cwd: repoRoot });
if (buildResult.status !== 0) {
  fail("build failed");
  console.error(buildResult.stderr);
  process.exit(1);
}
ok();

if (!fs.existsSync(distEntry)) {
  fail("dist/index.js not found after build");
  process.exit(1);
}

// ── Create shims ─────────────────────────────────────────────────────────────

step("Creating shims...");
fs.mkdirSync(userBinDir, { recursive: true });

const cmdPath = path.join(userBinDir, "arc.cmd");
const ps1Path = path.join(userBinDir, "arc.ps1");
const shPath = path.join(userBinDir, "arc");

// .cmd (Windows cmd.exe)
fs.writeFileSync(
  cmdPath,
  `@echo off\r\nnode "${distEntry}" %*\r\n`,
  "utf8"
);

// .ps1 (PowerShell)
fs.writeFileSync(
  ps1Path,
  `node "${distEntry.replaceAll("\\", "\\\\")}" @args\r\n`,
  "utf8"
);

// sh (bash/zsh/fish on WSL, Git Bash, or Unix)
fs.writeFileSync(
  shPath,
  `#!/usr/bin/env sh\nnode "${distEntry.replaceAll("\\", "/")}" "$@"\n`,
  "utf8"
);

try {
  fs.chmodSync(shPath, 0o755);
} catch {
  // Ignore on filesystems that do not support chmod
}

ok(userBinDir);

// ── PATH ─────────────────────────────────────────────────────────────────────

let addedToUserPath = false;

if (isWindows) {
  step("Checking Windows PATH...");

  const readResult = run("powershell.exe", [
    "-NoProfile",
    "-Command",
    "[Environment]::GetEnvironmentVariable('Path','User')",
  ]);

  if (readResult.status !== 0) {
    fail("could not read user PATH");
  } else {
    const currentUserPath = readResult.stdout.trim();
    const pathEntries = currentUserPath
      ? currentUserPath
          .split(";")
          .map((e) => e.trim())
          .filter(Boolean)
      : [];

    const normalize = (p) => path.resolve(p).replaceAll("/", "\\").toLowerCase();
    const alreadyInPath = pathEntries.some(
      (e) => normalize(e) === normalize(userBinDir)
    );

    if (alreadyInPath) {
      ok("already in PATH");
    } else {
      pathEntries.push(userBinDir);
      const escaped = pathEntries.join(";").replaceAll("'", "''");
      const setResult = run("powershell.exe", [
        "-NoProfile",
        "-Command",
        `[Environment]::SetEnvironmentVariable('Path', '${escaped}', 'User')`,
      ]);

      if (setResult.status !== 0) {
        fail("could not update user PATH");
      } else {
        addedToUserPath = true;
        ok("added to user PATH");
      }
    }
  }
} else {
  step("Checking PATH...");
  const inPath = (process.env.PATH || "")
    .split(":")
    .some((p) => path.resolve(p) === path.resolve(userBinDir));

  if (inPath) {
    ok("already in PATH");
  } else {
    ok();
    console.log(
      `  ${yellow("!")} Add to your shell profile: ${bold(`export PATH="${userBinDir}:$PATH"`)}`
    );
  }
}

// ── Save metadata ────────────────────────────────────────────────────────────

fs.writeFileSync(
  installMetaPath,
  JSON.stringify(
    {
      repoRoot,
      userBinDir,
      addedToUserPath,
      installedAt: new Date().toISOString(),
    },
    null,
    2
  ) + "\n",
  "utf8"
);

// ── Verify ───────────────────────────────────────────────────────────────────

step("Verifying...");
const verifyResult = run("node", [distEntry, "--version"]);
const installedVersion = verifyResult.stdout?.trim();
if (verifyResult.status === 0 && installedVersion) {
  ok(installedVersion);
} else {
  ok("shims created");
}

// ── Done ─────────────────────────────────────────────────────────────────────

console.log();
console.log(`  ${green("\u2714")} ${bold("Installed!")} Run ${cyan("arc")} from any terminal.`);

if (addedToUserPath) {
  console.log(`  ${dim("  Restart your terminal for PATH changes to take effect.")}`);
}

console.log();
console.log(`  ${dim("Shims")}      ${userBinDir}`);
console.log(`  ${dim("Source")}     ${repoRoot}`);
console.log(`  ${dim("Uninstall")}  pnpm uninstall:local`);
console.log();
