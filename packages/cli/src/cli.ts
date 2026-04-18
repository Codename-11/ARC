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
      "Auth type (oauth, api-key, bedrock, vertex, foundry, openai-compat)"
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
    .option("-d, --dashboard", "Start web dashboard alongside agent")
    .option("--native", "Run the tool with full TTY handoff (ARC exits, tool paints its own TUI)")
    .option("--worker", "Run the tool under ARC supervision (stdout captured for orchestration)")
    .option("--bare", "Skip profile resolution and env injection — spawn the named tool natively")
    .passThroughOptions()
    .allowUnknownOption()
    .allowExcessArguments()
    .addHelpText(
      "after",
      `
All flags after the profile name are forwarded to the agent tool.

Launch modes:
  --native   Full TTY handoff (default). ARC exits; tool paints its own TUI
             (e.g. Claude's statusLine). Best for daily interactive use.
  --worker   Run under ARC supervision. Stdout captured for monitoring /
             orchestration (roundtable, pipelines). Suppresses native TUI chrome.

If neither flag is given, the profile's \`launchMode\` setting is used
(fallback: native).

Examples:
  $ arc launch work
  $ arc launch work --native
  $ arc launch work --worker
  $ arc launch work --model sonnet
  $ arc launch work --dashboard
  $ arc launch work --dangerously-skip-permissions
  $ arc launch work -p "explain this code"
  $ arc launch -- --model sonnet      (use -- when omitting profile name)
  $ arc launch --bare claude          (native launch, no profile env)
`
    )
    .action(
      async (
        name: string | undefined,
        opts: { dashboard?: boolean; native?: boolean; worker?: boolean; bare?: boolean },
        cmd: Command
      ) => {
        // Re-inject parsed launch-mode flags into the args array so handleLaunch can see them.
        // (Commander strips recognized options, but handleLaunch's CLI-flag extractor expects
        // them in the raw-args stream.)
        const extraArgs: string[] = [];
        if (opts.native) extraArgs.push("--native");
        if (opts.worker) extraArgs.push("--worker");
        const mergedArgs = extraArgs.length > 0 ? [...cmd.args, ...extraArgs] : cmd.args;
        const mod = await import("./commands/launch.js");
        await mod.handleLaunch(name, mergedArgs, {
          dashboard: opts.dashboard,
          bare: opts.bare,
        });
      }
    );

  program
    .command("run <tool> [args...]")
    .description("Run a native agent tool (claude/codex/gemini/…) with no profile env injection")
    .passThroughOptions()
    .allowUnknownOption()
    .allowExcessArguments()
    .addHelpText(
      "after",
      `
Thin alias for 'arc launch --bare <tool>'. Ambient environment only —
no CLAUDE_CONFIG_DIR, GEMINI_CLI_HOME, CODEX_HOME, or ARC env vars set.

Examples:
  $ arc run claude --version
  $ arc run gemini --help
  $ arc run codex -- some-flag
`
    )
    .action(
      async (
        tool: string,
        _args: string[],
        _opts: Record<string, never>,
        cmd: Command
      ) => {
        // `cmd.args` = [tool, ...rest]; pass the rest through to the binary.
        const rest = cmd.args.slice(1);
        const mod = await import("./commands/run.js");
        await mod.handleRun(tool, rest);
      }
    );

  program
    .command("chat")
    .description("Interactive chat with your active profile's agent (with ARC tool use)")
    .option("--profile <name>", "Profile to use (default: active)")
    .option("--mode <mode>", "Permission mode (read-only|supervised|autonomous)", "supervised")
    .option("--once <prompt>", "One-shot mode: send prompt, stream response, exit")
    .option("--no-tools", "Disable ARC tool use (plain chat only)")
    .option("--session <id>", "Resume a previous chat session")
    .option("--new", "Force a new session (default when --session is absent)")
    .addHelpText(
      "after",
      `
Examples:
  $ arc chat                                     (interactive REPL)
  $ arc chat --once "list my profiles"           (one-shot)
  $ arc chat --mode read-only                    (no writes)
  $ arc chat --session abc-123                   (resume)
  $ arc chat --no-tools                          (plain chat only)

REPL commands:
  /exit /quit          End the session
  /save                Save the session to disk
  /new                 Start a new session
  /mode <m>            Switch permission mode
  /sessions            List saved sessions
  /resume <id>         Resume a saved session
  /help                Show command list
`,
    )
    .action(
      async (opts: {
        profile?: string;
        mode?: string;
        once?: string;
        tools?: boolean;
        session?: string;
        new?: boolean;
      }) => {
        const mod = await import("./commands/chat.js");
        await mod.handleChat({
          profile: opts.profile,
          mode: opts.mode as "read-only" | "supervised" | "autonomous" | undefined,
          once: opts.once,
          noTools: opts.tools === false,
          session: opts.session,
          new: opts.new,
        });
      },
    );

  program
    .command("set-key [name]")
    .description("Store an API key for a profile")
    .option("--from-env <var>", "Read key from environment variable")
    .action(async (name?: string, opts?: { fromEnv?: string }) => {
      const mod = await import("./commands/set-key.js");
      await mod.handleSetKey(name, opts ?? {});
    });

  // === Secret Store Commands ===

  const secret = program
    .command("secret")
    .alias("s")
    .description("Manage encrypted secrets");

  secret
    .command("set <name>")
    .description("Store a secret (interactive prompt, --from-stdin, or --from-file)")
    .option("--from-stdin", "Read secret value from stdin pipe")
    .option("--from-file <path>", "Read secret value from a file")
    .action(async (name: string, opts: { fromStdin?: boolean; fromFile?: string }) => {
      const mod = await import("./commands/secret.js");
      await mod.handleSecretSet(name, opts);
    });

  secret
    .command("get <name>")
    .description("Retrieve a secret value")
    .option("--quiet", "Output value only (no decoration)")
    .action(async (name: string, opts: { quiet?: boolean }) => {
      const mod = await import("./commands/secret.js");
      await mod.handleSecretGet(name, opts);
    });

  secret
    .command("list")
    .alias("ls")
    .description("List all stored secrets (metadata only)")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const mod = await import("./commands/secret.js");
      await mod.handleSecretList(opts);
    });

  secret
    .command("delete <name>")
    .alias("rm")
    .description("Delete a secret")
    .option("--force", "Skip confirmation prompt")
    .action(async (name: string, opts: { force?: boolean }) => {
      const mod = await import("./commands/secret.js");
      await mod.handleSecretDelete(name, opts);
    });

  program
    .command("status")
    .description("Show status of all profiles")
    .action(async () => {
      const mod = await import("./commands/status.js");
      await mod.handleStatus();
    });

  // === Auth Management ===

  const auth = program
    .command("auth")
    .description("Manage authentication across profiles");

  auth
    .command("status [profile]")
    .description("Show auth status for one or all profiles")
    .option("--json", "Output machine-readable JSON")
    .action(async (profile?: string, opts?: { json?: boolean }) => {
      const mod = await import("./commands/auth.js");
      await mod.handleAuthStatus(profile, opts ?? {});
    });

  auth
    .command("login <profile>")
    .description("Trigger OAuth login for a specific profile")
    .action(async (profile: string) => {
      const mod = await import("./commands/auth.js");
      await mod.handleAuthLogin(profile);
    });

  auth
    .command("refresh <profile>")
    .description("Check or force token refresh for an OAuth profile")
    .action(async (profile: string) => {
      const mod = await import("./commands/auth.js");
      await mod.handleAuthRefresh(profile);
    });

  auth
    .command("whoami [profile]")
    .description("Show which account is active for a profile")
    .option("--json", "Output machine-readable JSON")
    .action(async (profile?: string, opts?: { json?: boolean }) => {
      const mod = await import("./commands/auth.js");
      await mod.handleAuthWhoami(profile, opts ?? {});
    });

  program
    .command("which")
    .description("Show resolved profile for current directory")
    .action(async () => {
      const mod = await import("./commands/which.js");
      await mod.handleWhich();
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
      "Auth type (oauth, api-key, bedrock, vertex, foundry, openai-compat)"
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
    .description("Switch active profile (use 'none' or 'off' to clear)")
    .addHelpText("after", `
Examples:
  $ arc profile switch work
  $ arc profile switch none           (clear active profile)
  $ arc profile switch off            (same — native launches via 'arc run <tool>')
`)
    .action(async (name: string) => {
      const mod = await import("./commands/profile.js");
      await mod.handleSwitch(name);
    });

  profile
    .command("clear-active")
    .alias("clear")
    .description("Clear the active profile — tools launch natively via 'arc run'")
    .action(async () => {
      const mod = await import("./commands/profile.js");
      await mod.handleClearActive();
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
    .command("clone <src> <dst>")
    .description("Clone an existing profile (copies config directory by default)")
    .option("--no-copy-dir", "Clone the profile record only, skipping the config directory copy")
    .action(async (src: string, dst: string, opts: { copyDir?: boolean }) => {
      const mod = await import("./commands/profile.js");
      await mod.handleClone(src, dst, opts);
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
    .command("export <name>")
    .description("Export a profile to a portable JSON file (inlines instructions)")
    .option("--out <file>", "Output path (default: ./<name>.arc-profile.json)")
    .action(async (name: string, opts: { out?: string }) => {
      const mod = await import("./commands/export.js");
      await mod.handleProfileExport(name, opts);
    });

  profile
    .command("import-file <file>")
    .description("Import a profile from a JSON file produced by `arc profile export`")
    .option("--as <newname>", "Rename the profile on import")
    .option("--force", "Overwrite an existing profile with the same name")
    .action(async (file: string, opts: { as?: string; force?: boolean }) => {
      const mod = await import("./commands/export.js");
      await mod.handleProfileImport(file, opts);
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

  // === Agent Instructions ===

  const instructions = program
    .command("instructions")
    .alias("inst")
    .description("Manage agent instructions / system prompts per profile");

  instructions
    .command("show [name]")
    .description("Show resolved instructions for a profile (default: active)")
    .action(async (name?: string) => {
      const mod = await import("./commands/instructions.js");
      await mod.handleInstructionsShow(name);
    });

  instructions
    .command("set <name>")
    .description("Set inline instructions for a profile")
    .option("--from-file <path>", "Read instructions from a file instead of inline")
    .option("--file <path>", "Set instructionsFile path (read at launch time)")
    .action(async (name: string, opts: { fromFile?: string; file?: string }) => {
      const mod = await import("./commands/instructions.js");
      await mod.handleInstructionsSet(name, opts);
    });

  instructions
    .command("edit <name>")
    .description("Open instructions in $EDITOR")
    .action(async (name: string) => {
      const mod = await import("./commands/instructions.js");
      await mod.handleInstructionsEdit(name);
    });

  instructions
    .command("clear <name>")
    .description("Remove instructions from a profile")
    .action(async (name: string) => {
      const mod = await import("./commands/instructions.js");
      await mod.handleInstructionsClear(name);
    });

  // === Provider Configuration ===

  const provider = program
    .command("provider")
    .description("Configure custom OpenAI-compatible providers for profiles");

  provider
    .command("set <name>")
    .description("Set provider config on a profile")
    .option("--base-url <url>", "API base URL (e.g. https://openrouter.ai/api/v1)")
    .option("--model <model>", "Model identifier (e.g. anthropic/claude-3.5-sonnet)")
    .option("--api-key-var <var>", "Env var name for the API key (default: OPENAI_API_KEY)")
    .option("--display-name <name>", "Provider display name (e.g. OpenRouter, Ollama)")
    .action(async (name: string, opts: { baseUrl?: string; model?: string; apiKeyVar?: string; displayName?: string }) => {
      const mod = await import("./commands/provider.js");
      await mod.handleProviderSet(name, opts);
    });

  provider
    .command("show [name]")
    .description("Show provider config for a profile (default: active)")
    .action(async (name?: string) => {
      const mod = await import("./commands/provider.js");
      await mod.handleProviderShow(name);
    });

  provider
    .command("clear <name>")
    .description("Remove provider config from a profile")
    .action(async (name: string) => {
      const mod = await import("./commands/provider.js");
      await mod.handleProviderClear(name);
    });

  provider
    .command("presets")
    .description("List known provider presets (OpenRouter, Ollama, LM Studio, etc.)")
    .action(async () => {
      const mod = await import("./commands/provider.js");
      await mod.handleProviderPresets();
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
      if (!profileName || !config.profiles[profileName]) {
        showError(profileName ? `Profile "${profileName}" not found.` : "No active profile — pass a name.");
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
      const profile = profileName ? config.profiles[profileName] : undefined;

      if (!profile || !profileName) {
        showError(profileName ? `Profile "${profileName}" not found.` : "No active profile — pass a name.");
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

  swap
    .command("status")
    .description("Show per-tool active account status")
    .action(async () => {
      const { swapStatus } = await import("./swap.js");
      const status = swapStatus();
      console.log();
      for (const { tool, account, meta } of status) {
        const label = tool.padEnd(10);
        if (account) {
          const metaParts: string[] = [];
          if (meta?.subscription) metaParts.push(meta.subscription);
          if (meta?.tier) metaParts.push(meta.tier);
          const metaStr = metaParts.length > 0 ? ` (${metaParts.join("/")})` : "";
          console.log(`  ${label} \u2192 ${account}${metaStr}`);
        } else {
          console.log(`  ${label} \u2192 (none captured)`);
        }
      }
      console.log();
    });

  swap
    .command("from-profile <profile>")
    .description("Swap canonical credentials from an ARC profile")
    .action(async (profileName: string) => {
      const { swapFromProfile } = await import("./swap.js");
      const { loadConfig, resolveProfile } = await import("./config.js");
      const { success, error: showError, warn: showWarn, info: showInfo } = await import("./display.js");
      showWarn("[experimental] Credential hot-swap is an experimental feature.");

      const config = loadConfig();
      let profile;
      try {
        profile = resolveProfile(config, profileName);
      } catch {
        showError(`Profile "${profileName}" not found.`);
        process.exit(1);
      }

      const tool = profile.tool ?? "claude";
      const result = swapFromProfile(profileName, profile.configDir, tool);
      if (result.ok) {
        success(`Swapped ${tool} credentials from profile "${profileName}".`);
        showInfo("Restart any running desktop apps to use the new credentials.");
      } else {
        showError(result.error);
        process.exit(1);
      }
    });

  // === Backup / Restore ===

  const backup = program
    .command("backup")
    .description("Back up, restore, and list archives of the full ~/.arc/ state");

  backup
    .command("create")
    .description("Create a gzipped archive of ~/.arc/ (excludes credentials/ by default)")
    .option("--out <file>", "Output path (default: ~/.arc/backups/arc-backup-<timestamp>.tar.gz)")
    .option("--exclude-credentials", "Exclude ~/.arc/credentials/ (default: on)", true)
    .option("--include-credentials", "Include ~/.arc/credentials/ in the archive")
    .action(async (opts: { out?: string; excludeCredentials?: boolean; includeCredentials?: boolean }) => {
      const mod = await import("./commands/backup.js");
      const excludeCredentials = opts.includeCredentials ? false : opts.excludeCredentials ?? true;
      await mod.handleBackupCreate({ out: opts.out, excludeCredentials });
    });

  backup
    .command("restore <file>")
    .description("Restore a backup archive into ~/.arc/ (destructive)")
    .option("--force", "Overwrite an existing ~/.arc/config.json")
    .action(async (file: string, opts: { force?: boolean }) => {
      const mod = await import("./commands/backup.js");
      await mod.handleBackupRestore(file, opts);
    });

  backup
    .command("list")
    .alias("ls")
    .description("List archives in ~/.arc/backups/")
    .action(async () => {
      const mod = await import("./commands/backup.js");
      await mod.handleBackupList();
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

  // === Task Management ===

  const tasks = program
    .command("tasks")
    .alias("task")
    .description("Manage tasks (list, create, update, stop, output)");

  tasks
    .command("list")
    .alias("ls")
    .description("List tasks")
    .option("--status <status>", "Filter by status (created, assigned, working, completed, failed, cancelled)")
    .option("--assignee <name>", "Filter by assignee")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { status?: string; assignee?: string; json?: boolean }) => {
      const mod = await import("./commands/tasks.js");
      await mod.handleTasksList(opts);
    });

  tasks
    .command("create <description>")
    .description("Create a new task")
    .option("--priority <level>", "Priority (low, medium, high, critical)", "medium")
    .option("--assignee <name>", "Assign to a profile")
    .action(async (description: string, opts: { priority?: string; assignee?: string }) => {
      const mod = await import("./commands/tasks.js");
      await mod.handleTasksCreate(description, opts);
    });

  tasks
    .command("update <id>")
    .description("Update a task")
    .option("--status <status>", "New status")
    .option("--assignee <name>", "New assignee")
    .option("--priority <level>", "New priority")
    .action(async (id: string, opts: { status?: string; assignee?: string; priority?: string }) => {
      const mod = await import("./commands/tasks.js");
      await mod.handleTasksUpdate(id, opts);
    });

  tasks
    .command("stop <id>")
    .description("Cancel a task")
    .action(async (id: string) => {
      const mod = await import("./commands/tasks.js");
      await mod.handleTasksStop(id);
    });

  tasks
    .command("output <id> [text]")
    .description("View or append output for a task")
    .action(async (id: string, text?: string) => {
      const mod = await import("./commands/tasks.js");
      await mod.handleTasksOutput(id, text);
    });

  // === Memory ===

  const memory = program
    .command("memory")
    .alias("mem")
    .description("Manage persistent memory (list, search, prune, stats)");

  memory
    .command("list")
    .alias("ls")
    .description("List memory entries")
    .option("--scope <scope>", "Memory scope (session, persistent, team)", "persistent")
    .option("--type <type>", "Filter by type (fact, preference, correction, pattern, decision)")
    .option("--limit <n>", "Maximum entries to return", "20")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { scope?: string; type?: string; limit?: string; json?: boolean }) => {
      const mod = await import("./commands/memory.js");
      await mod.handleMemoryList(opts);
    });

  memory
    .command("search <query>")
    .description("Search memories by keyword relevance")
    .option("--limit <n>", "Maximum results", "20")
    .option("--json", "Output machine-readable JSON")
    .action(async (query: string, opts: { limit?: string; json?: boolean }) => {
      const mod = await import("./commands/memory.js");
      await mod.handleMemorySearch(query, opts);
    });

  memory
    .command("prune")
    .description("Archive or delete low-relevance memories")
    .option("--threshold <score>", "Score threshold (0-1)", "0.1")
    .option("--hard-delete", "Permanently delete instead of archiving")
    .action(async (opts: { threshold?: string; hardDelete?: boolean }) => {
      const mod = await import("./commands/memory.js");
      await mod.handleMemoryPrune(opts);
    });

  memory
    .command("stats")
    .description("Show memory statistics across all scopes")
    .action(async () => {
      const mod = await import("./commands/memory.js");
      await mod.handleMemoryStats();
    });

  // === Skills ===

  const skills = program
    .command("skills")
    .alias("skill")
    .description("Manage skill registry (list, load, info)");

  skills
    .command("list")
    .alias("ls")
    .description("List registered skills")
    .option("--source <source>", "Filter by source (user, generated, mcp, builtin)")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { source?: string; json?: boolean }) => {
      const mod = await import("./commands/skills.js");
      await mod.handleSkillsList(opts);
    });

  skills
    .command("load <directory>")
    .description("Load skill definitions from a directory")
    .action(async (directory: string) => {
      const mod = await import("./commands/skills.js");
      await mod.handleSkillsLoad(directory);
    });

  skills
    .command("info <name>")
    .description("Show detailed info about a skill")
    .action(async (name: string) => {
      const mod = await import("./commands/skills.js");
      await mod.handleSkillsInfo(name);
    });

  // === Sessions ===

  const sessions = program
    .command("sessions")
    .alias("session")
    .description("Manage sessions (list, resume, complete)");

  sessions
    .command("list")
    .alias("ls")
    .description("List sessions")
    .option("--status <status>", "Filter by status (active, suspended, completed)")
    .option("--profile <name>", "Filter by profile")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { status?: string; profile?: string; json?: boolean }) => {
      const mod = await import("./commands/sessions.js");
      await mod.handleSessionsList(opts);
    });

  sessions
    .command("resume [id]")
    .description("Resume a suspended session (default: last suspended)")
    .action(async (id?: string) => {
      const mod = await import("./commands/sessions.js");
      await mod.handleSessionsResume(id);
    });

  sessions
    .command("complete <id>")
    .description("Mark a session as completed")
    .action(async (id: string) => {
      const mod = await import("./commands/sessions.js");
      await mod.handleSessionsComplete(id);
    });

  // === Factory Mode ===

  const factory = program
    .command("factory")
    .description("Dark Factory mode — autonomous wave-based execution");

  factory
    .command("status")
    .description("Show current factory state and wave progress")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const mod = await import("./commands/factory.js");
      await mod.handleFactoryStatus(opts);
    });

  factory
    .command("abort")
    .description("Abort the current factory run")
    .action(async () => {
      const mod = await import("./commands/factory.js");
      await mod.handleFactoryAbort();
    });

  // === Remote Agents ===

  const remote = program
    .command("remote")
    .description("Manage remote agents (list, add, remove, check)");

  remote
    .command("list")
    .alias("ls")
    .description("List registered remote agents")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const mod = await import("./commands/remote.js");
      await mod.handleRemoteList(opts);
    });

  remote
    .command("add <name> <endpoint>")
    .description("Register a remote agent")
    .option("--transport <type>", "Transport protocol (http, ssh, mcp)", "http")
    .option("--profile <name>", "Associated profile")
    .action(async (name: string, endpoint: string, opts: { transport?: string; profile?: string }) => {
      const mod = await import("./commands/remote.js");
      await mod.handleRemoteAdd(name, endpoint, opts);
    });

  remote
    .command("remove <id>")
    .alias("rm")
    .description("Remove a remote agent by ID")
    .action(async (id: string) => {
      const mod = await import("./commands/remote.js");
      await mod.handleRemoteRemove(id);
    });

  remote
    .command("check [id]")
    .description("Health check one or all remote agents")
    .action(async (id?: string) => {
      const mod = await import("./commands/remote.js");
      await mod.handleRemoteCheck(id);
    });

  // === Plugins ===

  const plugins = program
    .command("plugins")
    .alias("plugin")
    .description("Manage plugins (list, install, uninstall, enable, disable)");

  plugins
    .command("list")
    .alias("ls")
    .description("List installed plugins")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const mod = await import("./commands/plugins.js");
      await mod.handlePluginsList(opts);
    });

  plugins
    .command("install <path>")
    .description("Install a plugin from a directory")
    .action(async (pluginPath: string) => {
      const mod = await import("./commands/plugins.js");
      await mod.handlePluginsInstall(pluginPath);
    });

  plugins
    .command("uninstall <name>")
    .alias("rm")
    .description("Uninstall a plugin by name")
    .action(async (name: string) => {
      const mod = await import("./commands/plugins.js");
      await mod.handlePluginsUninstall(name);
    });

  plugins
    .command("enable <name>")
    .description("Enable a disabled plugin")
    .action(async (name: string) => {
      const mod = await import("./commands/plugins.js");
      await mod.handlePluginsEnable(name);
    });

  plugins
    .command("disable <name>")
    .description("Disable a plugin without uninstalling")
    .action(async (name: string) => {
      const mod = await import("./commands/plugins.js");
      await mod.handlePluginsDisable(name);
    });

  // === Cloud Sync ===

  const sync = program
    .command("sync")
    .description("Cloud/filesystem sync (status, push, pull, configure)");

  sync
    .command("status")
    .description("Show sync configuration and connection status")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const mod = await import("./commands/sync.js");
      await mod.handleSyncStatus(opts);
    });

  sync
    .command("push")
    .description("Push local changes to the sync provider")
    .action(async () => {
      const mod = await import("./commands/sync.js");
      await mod.handleSyncPush();
    });

  sync
    .command("pull")
    .description("Pull remote changes from the sync provider")
    .action(async () => {
      const mod = await import("./commands/sync.js");
      await mod.handleSyncPull();
    });

  sync
    .command("configure")
    .description("Configure the sync provider")
    .option("--provider <type>", "Sync provider (filesystem)", "filesystem")
    .option("--path <dir>", "Shared directory path (required for filesystem provider)")
    .action(async (opts: { provider?: string; path?: string }) => {
      const mod = await import("./commands/sync.js");
      await mod.handleSyncConfigure(opts);
    });

  // === Web Dashboard ===

  program
    .command("web")
    .alias("dashboard-web")
    .description("Start the web dashboard server")
    .option("--port <port>", "HTTP port", "3700")
    .action(async (opts: { port?: string }) => {
      const mod = await import("./commands/dashboard-web.js");
      await mod.handleDashboardWeb(opts);
    });

  // === Telemetry ===

  const telemetry = program
    .command("telemetry")
    .description("Inspect traces and telemetry data");

  telemetry
    .command("traces")
    .description("Query trace spans from the JSONL file")
    .option("--limit <n>", "Maximum spans to show", "50")
    .option("--session <id>", "Filter by session ID or trace ID")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { limit?: string; session?: string; json?: boolean }) => {
      const mod = await import("./commands/telemetry.js");
      await mod.handleTelemetryTraces(opts);
    });

  telemetry
    .command("status")
    .description("Show telemetry configuration and file info")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const mod = await import("./commands/telemetry.js");
      await mod.handleTelemetryStatus(opts);
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

