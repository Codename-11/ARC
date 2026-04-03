import { Command } from "commander";
import { loadConfig } from "./config.js";
import { info, getBanner, getVersion } from "./display.js";
import { checkForUpdate } from "./update.js";
import { registerMcpCommand } from "./commands/mcp.js";

export function createProgram(): Command {
  const program = new Command();
  program.enablePositionalOptions();

  program
    .name("arc")
    .description("Manage agent runtime profiles for Claude, Gemini, Codex, and more")
    .version(getVersion())
    .addHelpText("before", getBanner() + "\n")
    .option("--no-tui", "Skip the TUI dashboard and print status instead")
    .action(async (opts: { tui?: boolean }) => {
      const config = loadConfig();
      const hasProfiles = Object.keys(config.profiles).length > 0;

      // Launch TUI for interactive terminals (even with no profiles — TUI handles onboarding)
      if (process.stdout.isTTY && opts.tui !== false) {
        const { renderDashboard } = await import("./tui/render.js");
        await renderDashboard();
        return;
      }

      // Non-interactive: fall back to CLI onboarding or status
      if (!hasProfiles) {
        const { runOnboarding } = await import("./commands/onboarding.js");
        await runOnboarding();
        return;
      }

      const { handleStatus } = await import("./commands/status.js");
      await handleStatus();

      // Non-blocking update check for CLI users
      checkForUpdate().then((update) => {
        if (update?.updateAvailable) {
          console.log(`\n  Update available: v${update.current} → v${update.latest}`);
          console.log(`  Run \x1b[36marc update\x1b[0m to upgrade.\n`);
        }
      }).catch(() => {});
    });

  // === Quick Commands (most common operations at top level) ===

  program
    .command("create <name>")
    .description("Create a new profile")
    .option(
      "--auth-type <type>",
      "Auth type (oauth, api-key, bedrock, vertex, foundry)"
    )
    .option("--tool <tool>", "Agent tool binary (claude, gemini, codex, ...)")
    .option("--description <desc>", "Profile description")
    .action(
      async (name: string, opts: { authType?: string; tool?: string; description?: string }) => {
        const mod = await import("./commands/profile.js");
        await mod.handleCreate(name, opts);
      }
    );

  program
    .command("use <name>")
    .alias("switch")
    .description("Switch active profile")
    .action(async (name: string) => {
      const mod = await import("./commands/profile.js");
      await mod.handleSwitch(name);
    });

  program
    .command("list")
    .alias("ls")
    .description("List all profiles")
    .action(async () => {
      const mod = await import("./commands/profile.js");
      await mod.handleList();
    });

  program
    .command("import [name]")
    .description("Import detected tool config into a profile")
    .option("--all", "Import all detected tool configs")
    .option("--from <path>", "Source config directory")
    .option("--tool <tool>", "Agent tool this config belongs to (claude, gemini, codex, ...)")
    .option("--force", "Overwrite existing profiles")
    .action(
      async (
        name: string | undefined,
        opts: { all?: boolean; from?: string; tool?: string; force?: boolean }
      ) => {
        if (opts.all) {
          const { detectToolConfigs } = await import("./detect.js");
          const { handleImport } = await import("./commands/profile.js");
          const detected = detectToolConfigs();

          if (detected.length === 0) {
            const { error: showError } = await import("./display.js");
            showError("No tool configs detected. Nothing to import.");
            process.exit(1);
          }

          for (const dt of detected) {
            await handleImport({
              name: dt.tool,
              from: dt.configDir,
              tool: dt.tool,
              force: opts.force,
            });
          }
        } else {
          const profileName = name ?? "default";
          const mod = await import("./commands/profile.js");
          await mod.handleImport({
            name: profileName,
            from: opts.from,
            tool: opts.tool,
            force: opts.force,
          });
        }
      }
    );

  program
    .command("dashboard")
    .alias("dash")
    .description("Open the interactive TUI dashboard")
    .action(async () => {
      const { renderDashboard } = await import("./tui/render.js");
      await renderDashboard();
    });

  // === Lifecycle Commands ===

  program
    .command("setup")
    .description("Install local shims, check PATH, and add shell integration")
    .option("--shell <type>", "Shell type (bash, zsh, fish, powershell)")
    .option("--no-shell", "Skip shell profile integration")
    .action(async (opts: { shell?: string; noShell?: boolean }) => {
      const mod = await import("./commands/setup.js");
      await mod.handleSetup(opts);
    });

  program
    .command("update")
    .description("Refresh local shims, PATH, and shell integration")
    .option("--shell <type>", "Shell type (bash, zsh, fish, powershell)")
    .option("--no-shell", "Skip shell profile integration")
    .action(async (opts: { shell?: string; noShell?: boolean }) => {
      const mod = await import("./commands/setup.js");
      await mod.handleUpdate(opts);
    });

  program
    .command("uninstall")
    .description("Remove local shims, PATH entries, shell integration, and data")
    .option("--force", "Skip confirmation prompt")
    .action(async (opts: { force?: boolean }) => {
      const mod = await import("./commands/setup.js");
      await mod.handleUninstall(opts);
    });

  program
    .command("doctor")
    .description("Run diagnostics and check system health")
    .action(async () => {
      const mod = await import("./commands/doctor.js");
      await mod.handleDoctor();
    });

  program
    .command("health")
    .description("Run fast runtime readiness checks")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const mod = await import("./commands/health.js");
      await mod.handleHealth(opts);
    });

  program
    .command("logs")
    .description("Query structured ARC logs")
    .option("--limit <n>", "Maximum entries to return", "20")
    .option("--level <level>", "Filter by level (debug, info, warn, error)")
    .option("--component <name>", "Filter by component")
    .option("--profile <name>", "Filter by profile name")
    .option("--json", "Output machine-readable JSON")
    .action(
      async (opts: {
        limit?: string;
        level?: "debug" | "info" | "warn" | "error";
        component?: string;
        profile?: string;
        json?: boolean;
      }) => {
        const mod = await import("./commands/logs.js");
        await mod.handleLogs(opts);
      }
    );

  // === Session Commands ===

  program
    .command("launch [name]")
    .description("Launch agent tool with a profile")
    .passThroughOptions()
    .allowUnknownOption()
    .allowExcessArguments()
    .addHelpText(
      "after",
      `
All flags after the profile name are forwarded to the agent tool.

Examples:
  $ arc launch work
  $ arc launch work --model sonnet
  $ arc launch work --dangerously-skip-permissions
  $ arc launch work -p "explain this code"
  $ arc launch -- --model sonnet      (use -- when omitting profile name)
`
    )
    .action(
      async (
        name: string | undefined,
        _opts: Record<string, never>,
        cmd: Command
      ) => {
        const mod = await import("./commands/launch.js");
        await mod.handleLaunch(name, cmd.args);
      }
    );

  program
    .command("set-key [name]")
    .description("Store an API key for a profile")
    .option("--from-env <var>", "Read key from environment variable")
    .action(async (name?: string, opts?: { fromEnv?: string }) => {
      const mod = await import("./commands/set-key.js");
      await mod.handleSetKey(name, opts ?? {});
    });

  program
    .command("status")
    .description("Show status of all profiles")
    .action(async () => {
      const mod = await import("./commands/status.js");
      await mod.handleStatus();
    });

  // === Profile Management (organized group with all operations) ===

  const profile = program
    .command("profile")
    .alias("p")
    .description("All profile commands (show, delete, import, ...)");

  profile
    .command("create <name>")
    .alias("new")
    .description("Create a new profile")
    .option(
      "--auth-type <type>",
      "Auth type (oauth, api-key, bedrock, vertex, foundry)"
    )
    .option("--tool <tool>", "Agent tool binary (claude, gemini, codex, ...)")
    .option("--description <desc>", "Profile description")
    .action(
      async (name: string, opts: { authType?: string; tool?: string; description?: string }) => {
        const mod = await import("./commands/profile.js");
        await mod.handleCreate(name, opts);
      }
    );

  profile
    .command("list")
    .alias("ls")
    .description("List all profiles")
    .action(async () => {
      const mod = await import("./commands/profile.js");
      await mod.handleList();
    });

  profile
    .command("show [name]")
    .alias("info")
    .description("Show profile details")
    .action(async (name?: string) => {
      const mod = await import("./commands/profile.js");
      await mod.handleShow(name);
    });

  profile
    .command("switch <name>")
    .alias("use")
    .description("Switch active profile")
    .action(async (name: string) => {
      const mod = await import("./commands/profile.js");
      await mod.handleSwitch(name);
    });

  profile
    .command("delete <name>")
    .alias("rm")
    .description("Delete a profile")
    .option("--force", "Skip confirmation prompt")
    .action(async (name: string, opts: { force?: boolean }) => {
      const mod = await import("./commands/profile.js");
      await mod.handleDelete(name, opts);
    });

  profile
    .command("import")
    .description("Import existing agent tool config into a profile")
    .option("--name <name>", "Profile name", "default")
    .option("--from <path>", "Source config directory")
    .option("--tool <tool>", "Agent tool this config belongs to (claude, gemini, codex, ...)")
    .option("--force", "Overwrite existing profile")
    .action(async (opts: { name: string; from?: string; tool?: string; force?: boolean }) => {
      const mod = await import("./commands/profile.js");
      await mod.handleImport(opts);
    });

  profile
    .command("set-flags <name> <flags...>")
    .description("Set persistent launch flags for a profile (prepended on every launch)")
    .addHelpText("after", `
Examples:
  $ arc profile set-flags work --dangerously-skip-permissions
  $ arc profile set-flags work --model sonnet --verbose
  $ arc profile set-flags work --clear    (remove all flags)
`)
    .action(async (name: string, flags: string[]) => {
      const { loadConfig, saveConfig } = await import("./config.js");
      const { success, error: showError, info: showInfo } = await import("./display.js");

      const config = loadConfig();
      const profile = config.profiles[name];
      if (!profile) {
        showError(`Profile "${name}" not found.`);
        process.exit(1);
      }

      if (flags.length === 1 && flags[0] === "--clear") {
        profile.launchArgs = undefined;
        saveConfig(config);
        success(`Cleared launch flags for "${name}".`);
        return;
      }

      profile.launchArgs = flags;
      saveConfig(config);
      success(`Launch flags for "${name}": ${flags.join(" ")}`);
      showInfo("These flags will be prepended on every `arc launch`.");
    });

  // === Shared Layer ===

  const shared = program
    .command("shared")
    .description(
      "Manage the shared config layer — MCPs and commands shared across profiles"
    );

  shared
    .command("status")
    .description("Show shared layer contents and per-profile enable status")
    .action(async () => {
      const mod = await import("./commands/shared.js");
      await mod.handleSharedStatus();
    });

  shared
    .command("enable [name]")
    .description(
      "Enable the shared layer for a profile and sync it (default: active profile)"
    )
    .option("--memory", "Link profile memory/ to shared/memory/ (junction/symlink)")
    .option("--projects", "Link profile projects/ to shared/projects/ (junction/symlink)")
    .option("--claude-md", "Prepend shared CLAUDE.md to profile CLAUDE.md")
    .action(
      async (
        name: string | undefined,
        opts: { memory?: boolean; projects?: boolean; claudeMd?: boolean }
      ) => {
        const mod = await import("./commands/shared.js");
        await mod.handleSharedEnable(name, opts);
      }
    );

  shared
    .command("disable [name]")
    .description(
      "Disable the shared layer for a profile and remove synced items (default: active profile)"
    )
    .option("--memory", "Only unlink the shared memory/ junction/symlink")
    .option("--projects", "Only unlink the shared projects/ junction/symlink")
    .action(
      async (
        name: string | undefined,
        opts: { memory?: boolean; projects?: boolean }
      ) => {
        const mod = await import("./commands/shared.js");
        await mod.handleSharedDisable(name, opts);
      }
    );

  shared
    .command("sync")
    .description("Re-apply the shared layer to enabled profiles")
    .option("--all", "Sync all profiles that have the shared layer enabled")
    .option("--name <name>", "Profile name to sync (default: active profile)")
    .action(async (opts: { all?: boolean; name?: string }) => {
      const mod = await import("./commands/shared.js");
      await mod.handleSharedSync(opts);
    });

  shared
    .command("source [name]")
    .description("Set (or clear) a profile as the sync source for the shared layer")
    .option("--clear", "Remove the sync source")
    .action(async (name?: string, opts?: { clear?: boolean }) => {
      const { loadConfig, saveConfig } = await import("./config.js");
      const { success, error: showError, info: showInfo } = await import("./display.js");

      const config = loadConfig();
      if (opts?.clear) {
        config.sharedSource = undefined;
        saveConfig(config);
        success("Shared layer sync source cleared.");
        return;
      }

      const profileName = name ?? config.activeProfile;
      if (!config.profiles[profileName]) {
        showError(`Profile "${profileName}" not found.`);
        process.exit(1);
      }

      config.sharedSource = profileName;
      saveConfig(config);
      success(`Shared layer sync source set to "${profileName}".`);
      showInfo("Running `arc shared sync` will auto-pull from this profile first.");
    });

  shared
    .command("pull [name]")
    .description("Pull a profile's MCPs, commands, and CLAUDE.md into the shared layer")
    .action(async (name?: string) => {
      const { loadConfig } = await import("./config.js");
      const { pullProfileToShared } = await import("./shared.js");
      const { success, error: showError, info: showInfo } = await import("./display.js");

      const config = loadConfig();
      const profileName = name ?? config.activeProfile;
      const profile = config.profiles[profileName];

      if (!profile) {
        showError(`Profile "${profileName}" not found.`);
        process.exit(1);
      }

      showInfo(`Pulling config from "${profileName}" into shared layer...`);
      const result = pullProfileToShared(profile.configDir, profile.tool ?? "claude");

      const parts: string[] = [];
      if (result.mcpServers.length) parts.push(`${result.mcpServers.length} MCP servers`);
      if (result.commands.length) parts.push(`${result.commands.length} commands`);
      if (result.adapterArtifacts.length) parts.push(`${result.adapterArtifacts.length} adapter artifacts`);

      if (parts.length > 0) {
        success(`Shared layer updated: ${parts.join(", ")}.`);
        showInfo("Run `arc shared enable <profile>` on other profiles to sync, or press h in TUI.");
      } else {
        showInfo("No MCP servers, commands, or adapter artifacts found in this profile.");
      }
    });

  shared
    .command("show")
    .description("Print the current shared settings.json")
    .action(async () => {
      const mod = await import("./commands/shared.js");
      await mod.handleSharedShow();
    });

  // === Config / Settings ===

  const configCmd = program
    .command("config")
    .description("View or change ARC settings");

  configCmd
    .command("get [key]")
    .description("Show a setting value (or all settings if no key)")
    .action(async (key?: string) => {
      const { loadConfig } = await import("./config.js");
      const { info: showInfo } = await import("./display.js");
      const config = loadConfig();
      const settings = config.settings ?? {};
      if (key) {
        const val = (settings as Record<string, unknown>)[key];
        showInfo(`${key} = ${val === undefined ? "(not set)" : JSON.stringify(val)}`);
      } else {
        showInfo("Settings:");
        for (const [k, v] of Object.entries(settings)) {
          console.log(`  ${k} = ${JSON.stringify(v)}`);
        }
        if (Object.keys(settings).length === 0) {
          console.log("  (no settings configured — using defaults)");
        }
      }
    });

  configCmd
    .command("set <key> <value>")
    .description("Set a config value (true/false for booleans)")
    .action(async (key: string, value: string) => {
      const { loadConfig, saveConfig } = await import("./config.js");
      const { success } = await import("./display.js");
      const config = loadConfig();
      if (!config.settings) config.settings = {};

      // Parse value
      let parsed: unknown = value;
      if (value === "true") parsed = true;
      else if (value === "false") parsed = false;
      else if (/^\d+$/.test(value)) parsed = Number(value);

      (config.settings as Record<string, unknown>)[key] = parsed;
      saveConfig(config);
      success(`${key} = ${JSON.stringify(parsed)}`);
    });

  // === Credential Hot-Swap (experimental) ===

  const swap = program
    .command("swap")
    .description("[experimental] Hot-swap credentials without changing MCPs or settings");

  swap
    .command("capture <account>")
    .description("Capture current credentials as a named account snapshot")
    .option("--tool <tool>", "Agent tool (claude, gemini, codex)", "claude")
    .action(async (account: string, opts: { tool: string }) => {
      const { captureAccount } = await import("./swap.js");
      const { success, error: showError, warn: showWarn } = await import("./display.js");
      showWarn("[experimental] Credential hot-swap is an experimental feature.");
      const result = captureAccount(account, opts.tool);
      if (result.ok) {
        success(`Captured credentials as "${account}" for ${opts.tool}.`);
      } else {
        showError(result.error);
        process.exit(1);
      }
    });

  swap
    .command("to <account>")
    .description("Swap to a captured account's credentials")
    .option("--force", "Skip confirmation prompt")
    .action(async (account: string, opts: { force?: boolean }) => {
      const { swapTo } = await import("./swap.js");
      const { success, error: showError, info: showInfo, warn: showWarn } = await import("./display.js");
      showWarn("[experimental] Credential hot-swap is an experimental feature.");

      if (!opts.force) {
        const readline = await import("node:readline");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(`  Swap credentials to "${account}"? This modifies your tool's config directory. [y/N] `, resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== "y") {
          showInfo("Cancelled.");
          return;
        }
      }

      const result = swapTo(account);
      if (result.ok) {
        success(`Swapped to "${account}" (${result.tool}). MCPs, settings, and history preserved.`);
        showInfo("Restart any running agent tool sessions to use the new credentials.");
      } else {
        showError(result.error);
        process.exit(1);
      }
    });

  swap
    .command("list")
    .alias("ls")
    .description("List captured account snapshots")
    .action(async () => {
      const { listAccounts } = await import("./swap.js");
      const { info: showInfo } = await import("./display.js");
      const accounts = listAccounts();
      if (accounts.length === 0) {
        showInfo("No account snapshots captured yet. Use `arc swap capture <name>` to start.");
        return;
      }
      console.log();
      for (const a of accounts) {
        const marker = a.isActive ? " *" : "  ";
        console.log(`${marker} ${a.name.padEnd(20)} ${a.tool.padEnd(10)} ${a.isActive ? "(active)" : ""}`);
      }
      console.log();
    });

  swap
    .command("delete <account>")
    .alias("rm")
    .description("Delete a captured account snapshot")
    .action(async (account: string) => {
      const { deleteAccount } = await import("./swap.js");
      const { success, error: showError } = await import("./display.js");
      const result = deleteAccount(account);
      if (result.ok) {
        success(`Deleted account snapshot "${account}".`);
      } else {
        showError(result.error);
        process.exit(1);
      }
    });

  // === Advanced Commands ===

  program
    .command("exec [name]")
    .description("Run a command with profile environment")
    .passThroughOptions()
    .allowUnknownOption()
    .allowExcessArguments()
    .addHelpText(
      "after",
      `
All arguments after the profile name are treated as the command to run.

Examples:
  $ arc exec work node app.js --port 3000
  $ arc exec work npm test
  $ arc exec -- npm test                  (use -- when omitting profile name)
`
    )
    .action(
      async (
        name: string | undefined,
        _opts: Record<string, never>,
        cmd: Command
      ) => {
        const mod = await import("./commands/exec.js");
        await mod.handleExec(name, cmd.args);
      }
    );

  program
    .command("shell [name]")
    .description("Open a subshell with profile environment")
    .action(async (name?: string) => {
      const mod = await import("./commands/shell.js");
      await mod.handleShell(name);
    });

  program
    .command("shell-init")
    .description("Output shell integration code")
    .option("--shell <type>", "Shell type (bash, zsh, fish, powershell)")
    .action(async (opts: { shell?: string }) => {
      const mod = await import("./commands/shell-init.js");
      await mod.handleShellInit(opts);
    });

  program
    .command("prune")
    .description("Remove all arc data, profiles, and credentials")
    .option("--force", "Skip confirmation prompt")
    .action(async (opts: { force?: boolean }) => {
      const mod = await import("./commands/prune.js");
      await mod.handlePrune(opts);
    });

  program
    .command("_resolve-config-dir")
    .description("Resolve the config directory for the active profile (internal)")
    .action(async () => {
      const mod = await import("./commands/resolve.js");
      await mod.handleResolveConfigDir();
    });

  // === MCP Server ===

  registerMcpCommand(program);

  // Hide internal command from help output
  const resolveCmd = program.commands.find(
    (c) => c.name() === "_resolve-config-dir"
  );
  if (resolveCmd) {
    (resolveCmd as unknown as { _hidden: boolean })._hidden = true;
  }

  // Add examples and tips after help
  program.addHelpText(
    "after",
    `
Examples:
  $ arc create work --auth-type oauth
  $ arc create gemini-work --tool gemini --auth-type api-key
  $ arc import                          (import Claude config as "default")
  $ arc import --all                    (import all detected tool configs)
  $ arc setup
  $ arc launch work --model sonnet
  $ arc launch work -p "explain this code"
  $ arc use personal
  $ arc list
  $ arc shell-init --shell powershell | Out-String | Invoke-Expression

Tip: Flags after the profile name pass through to the agent tool.
     "create", "use|switch", "list|ls", and "import" are top-level shortcuts.
     Run "arc profile --help" for all profile management commands.
`
  );

  return program;
}

