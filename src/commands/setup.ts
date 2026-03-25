import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { error, info, success, warn, detail, sectionHeader } from "../display.js";

type ShellType = "bash" | "zsh" | "fish" | "powershell";

function detectShell(): ShellType {
  if (process.platform === "win32") {
    return "powershell";
  }

  const shellEnv = process.env["SHELL"] ?? "";
  const base = path.basename(shellEnv);
  if (base === "zsh") return "zsh";
  if (base === "fish") return "fish";
  return "bash";
}

function getPackageRoot(): string {
  const entryScript = process.argv[1];
  if (entryScript) {
    return path.resolve(path.dirname(entryScript), "..");
  }

  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), "..");
}

function getSetupScriptPath(): string {
  return path.join(getPackageRoot(), "scripts", "setup-local-bin.js");
}

function getUninstallScriptPath(): string {
  return path.join(getPackageRoot(), "scripts", "uninstall.js");
}

/**
 * Returns true if ARC is running from a bootstrap git install
 * (i.e. the package root is inside ~/.arc-install).
 * Dev repo installs and npm global installs return false.
 */
function isBootstrapInstall(): boolean {
  const packageRoot = getPackageRoot();
  const bootstrapRoot = path.join(os.homedir(), ".arc-install");
  return packageRoot.startsWith(bootstrapRoot);
}

function runCommand(cmd: string, args: string[], cwd: string): void {
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd, shell: true });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runNodeScript(scriptPath: string, args: string[] = []): void {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function getShellInitProfileLine(shell: ShellType): string {
  switch (shell) {
    case "fish":
      return "arc shell-init --shell fish | source";
    case "powershell":
      return "arc shell-init --shell powershell | Out-String | Invoke-Expression";
    case "bash":
    case "zsh":
      return `eval "$(arc shell-init --shell ${shell})"`;
  }
}

function getShellProfilePath(shell: ShellType): string | null {
  const home = os.homedir();

  switch (shell) {
    case "powershell":
      return path.join(
        home,
        "Documents",
        "PowerShell",
        "Microsoft.PowerShell_profile.ps1"
      );
    case "bash":
      return path.join(home, ".bashrc");
    case "zsh":
      return path.join(home, ".zshrc");
    case "fish":
      return path.join(home, ".config", "fish", "config.fish");
  }
}

function ensureShellProfile(shell: ShellType): void {
  const profilePath = getShellProfilePath(shell);
  if (!profilePath) {
    warn(`No profile path is configured for shell: ${shell}`);
    return;
  }

  const profileDir = path.dirname(profilePath);
  fs.mkdirSync(profileDir, { recursive: true });

  const profileLine = getShellInitProfileLine(shell);
  const marker = shell === "powershell" ? "# arc shell integration" : "# arc";
  const block = `${marker}\n${profileLine}\n`;
  const existing = fs.existsSync(profilePath)
    ? fs.readFileSync(profilePath, "utf8")
    : "";

  if (existing.includes(profileLine)) {
    info(`Shell integration already present in ${profilePath}`);
    return;
  }

  const needsSpacing = existing.length > 0 && !existing.endsWith("\n");
  const prefix = needsSpacing ? "\n" : "";
  fs.writeFileSync(profilePath, existing + prefix + block, "utf8");
  success(`Added shell integration to ${profilePath}`);
}

function printNextSteps(shell: ShellType): void {
  console.log();
  sectionHeader("Next Steps");
  console.log();
  detail('Open a new terminal session so PATH/profile changes are loaded.');
  detail(`Test the install with: arc --help`);
  detail(`Load shell integration now with: ${getShellInitProfileLine(shell)}`);
  console.log();
}

export async function handleSetup(opts: {
  shell?: string;
  noShell?: boolean;
}): Promise<void> {
  const shell = (opts.shell as ShellType | undefined) ?? detectShell();
  const setupScriptPath = getSetupScriptPath();

  if (!fs.existsSync(setupScriptPath)) {
    error(`Setup script not found: ${setupScriptPath}`);
    process.exit(1);
  }

  console.log();
  sectionHeader("Setup");
  console.log();
  info("Installing local arc shims and checking PATH...");
  runNodeScript(setupScriptPath);

  if (!opts.noShell) {
    info(`Installing ${shell} shell integration...`);
    ensureShellProfile(shell);
  } else {
    warn("Skipped shell profile integration (--no-shell).");
  }

  success("arc setup complete.");
  printNextSteps(shell);
}

export async function handleUpdate(opts: {
  shell?: string;
  noShell?: boolean;
}): Promise<void> {
  console.log();
  sectionHeader("Update");
  console.log();

  if (isBootstrapInstall()) {
    const packageRoot = getPackageRoot();
    info("Bootstrap install detected — pulling latest code...");
    runCommand("git", ["fetch", "--all", "--prune"], packageRoot);
    runCommand("git", ["reset", "--hard", "origin/main"], packageRoot);
    info("Installing dependencies...");
    runCommand("npm", ["install"], packageRoot);
    success("Code updated.");
    console.log();
  }

  info("Refreshing shims and shell integration...");
  await handleSetup(opts);
}

export async function handleUninstall(opts: {
  force?: boolean;
}): Promise<void> {
  const uninstallScriptPath = getUninstallScriptPath();

  if (!fs.existsSync(uninstallScriptPath)) {
    error(`Uninstall script not found: ${uninstallScriptPath}`);
    process.exit(1);
  }

  const args = opts.force ? ["--force"] : [];
  runNodeScript(uninstallScriptPath, args);
}
