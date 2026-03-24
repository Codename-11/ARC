import { Command } from "commander";
import { loadConfig } from "./config.js";
import { info, getBanner, getVersion } from "./display.js";

export function createProgram(): Command {
  const program = new Command();
  program.enablePositionalOptions();

  program
    .name("arc")
    .description("Manage agent runtime profiles for Claude, Gemini, Codex, and more")
    .version(getVersion())
    .addHelpText("before", getBanner() + "\n")
    .action(async () => {
      const config = loadConfig();
      const hasProfiles = Object.keys(config.profiles).length > 0;

      if (!hasProfiles) {
        const { runOnboarding } = await import("./commands/onboarding.js");
        await runOnboarding();
        return;
      }

      const active = config.activeProfile;
      const profile = config.profiles[active];
      if (profile) {
        info(`Active profile: ${active} (${profile.tool ?? "claude"} / ${profile.authType})`);
      } else {
        info(
          'No profiles configured. Run "arc create <name>" to get started.'
        );
      }
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
    .action(async (name: string) => {
      const mod = await import("./commands/profile.js");
      await mod.handleDelete(name);
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
  $ arc setup
  $ arc launch work --model sonnet
  $ arc launch work -p "explain this code"
  $ arc use personal
  $ arc list
  $ arc shell-init --shell powershell | Out-String | Invoke-Expression

Tip: Flags after the profile name pass through to the agent tool.
     "create", "use|switch", and "list|ls" are top-level shortcuts.
     Run "arc profile --help" for all profile management commands.
`
  );

  return program;
}
