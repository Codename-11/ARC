use anyhow::Result;
use clap::{Parser, Subcommand};

mod auth;
mod commands;
mod config;
mod detect;
mod display;
mod keyring;
mod paths;
mod shared;
mod tui;
mod types;

#[derive(Parser)]
#[command(
    name = "arc",
    version = "2.0.0",
    about = "Manage agent runtime profiles for Claude, Gemini, Codex, and more",
    before_help = "◆ arc v2.0.0 ─ Agent Runtime Control"
)]
struct Cli {
    /// Skip the TUI dashboard and print status instead
    #[arg(long = "no-tui", global = true)]
    no_tui: bool,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a new profile
    Create {
        /// Profile name
        name: String,
        /// Auth type (oauth, api-key, bedrock, vertex, foundry)
        #[arg(long)]
        auth_type: Option<String>,
        /// Agent tool binary (claude, gemini, codex, ...)
        #[arg(long)]
        tool: Option<String>,
        /// Profile description
        #[arg(long)]
        description: Option<String>,
    },

    /// Switch active profile (alias: switch)
    #[command(alias = "switch")]
    Use {
        /// Profile name
        name: String,
    },

    /// List all profiles (alias: ls)
    #[command(alias = "ls")]
    List,

    /// Import detected tool config into a profile
    Import {
        /// Profile name
        name: Option<String>,
        /// Import all detected tool configs
        #[arg(long)]
        all: bool,
        /// Source config directory
        #[arg(long)]
        from: Option<String>,
        /// Agent tool this config belongs to
        #[arg(long)]
        tool: Option<String>,
        /// Overwrite existing profiles
        #[arg(long)]
        force: bool,
    },

    /// Open the interactive TUI dashboard (alias: dash)
    #[command(alias = "dash")]
    Dashboard,

    /// Install local shims, check PATH, and add shell integration
    Setup {
        /// Shell type (bash, zsh, fish, powershell)
        #[arg(long)]
        shell: Option<String>,
        /// Skip shell profile integration
        #[arg(long = "no-shell")]
        no_shell: bool,
    },

    /// Refresh local shims, PATH, and shell integration
    Update {
        /// Shell type (bash, zsh, fish, powershell)
        #[arg(long)]
        shell: Option<String>,
        /// Skip shell profile integration
        #[arg(long = "no-shell")]
        no_shell: bool,
    },

    /// Remove local shims, PATH entries, shell integration, and data
    Uninstall {
        /// Skip confirmation prompt
        #[arg(long)]
        force: bool,
    },

    /// Run diagnostics and check system health
    Doctor,

    /// Launch agent tool with a profile
    Launch {
        /// Profile name (optional)
        name: Option<String>,
        /// Arguments to pass through to the agent tool
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },

    /// Store an API key for a profile
    #[command(name = "set-key")]
    SetKey {
        /// Profile name (optional, defaults to active)
        name: Option<String>,
        /// Read key from environment variable
        #[arg(long = "from-env")]
        from_env: Option<String>,
    },

    /// Show status of all profiles
    Status,

    /// All profile commands
    #[command(name = "profile", alias = "p")]
    Profile {
        #[command(subcommand)]
        command: ProfileCommands,
    },

    /// Manage the shared config layer
    Shared {
        #[command(subcommand)]
        command: SharedCommands,
    },

    /// Run a command with profile environment
    Exec {
        /// Profile name (optional)
        name: Option<String>,
        /// Command and arguments
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },

    /// Open a subshell with profile environment
    Shell {
        /// Profile name (optional)
        name: Option<String>,
    },

    /// Output shell integration code
    #[command(name = "shell-init")]
    ShellInit {
        /// Shell type (bash, zsh, fish, powershell)
        #[arg(long)]
        shell: Option<String>,
    },

    /// Remove all arc data, profiles, and credentials
    Prune {
        /// Skip confirmation prompt
        #[arg(long)]
        force: bool,
    },

    /// Resolve the config directory for the active profile (internal)
    #[command(name = "_resolve-config-dir", hide = true)]
    ResolveConfigDir,
}

#[derive(Subcommand)]
enum ProfileCommands {
    /// Create a new profile (alias: new)
    #[command(alias = "new")]
    Create {
        name: String,
        #[arg(long)]
        auth_type: Option<String>,
        #[arg(long)]
        tool: Option<String>,
        #[arg(long)]
        description: Option<String>,
    },

    /// List all profiles (alias: ls)
    #[command(alias = "ls")]
    List,

    /// Show profile details (alias: info)
    #[command(alias = "info")]
    Show {
        name: Option<String>,
    },

    /// Switch active profile (alias: use)
    #[command(alias = "use")]
    Switch {
        name: String,
    },

    /// Delete a profile (alias: rm)
    #[command(alias = "rm")]
    Delete {
        name: String,
    },

    /// Import existing agent tool config into a profile
    Import {
        #[arg(long, default_value = "default")]
        name: String,
        #[arg(long)]
        from: Option<String>,
        #[arg(long)]
        tool: Option<String>,
        #[arg(long)]
        force: bool,
    },
}

#[derive(Subcommand)]
enum SharedCommands {
    /// Show shared layer contents and per-profile enable status
    Status,

    /// Enable the shared layer for a profile and sync it
    Enable {
        /// Profile name (defaults to active)
        name: Option<String>,
        /// Link profile memory/ to shared/memory/
        #[arg(long)]
        memory: bool,
        /// Link profile projects/ to shared/projects/
        #[arg(long)]
        projects: bool,
        /// Prepend shared CLAUDE.md to profile CLAUDE.md
        #[arg(long = "claude-md")]
        claude_md: bool,
    },

    /// Disable the shared layer for a profile
    Disable {
        /// Profile name (defaults to active)
        name: Option<String>,
        /// Only unlink the shared memory/ junction/symlink
        #[arg(long)]
        memory: bool,
        /// Only unlink the shared projects/ junction/symlink
        #[arg(long)]
        projects: bool,
    },

    /// Re-apply the shared layer to enabled profiles
    Sync {
        /// Sync all profiles that have the shared layer enabled
        #[arg(long)]
        all: bool,
        /// Profile name to sync (default: active profile)
        #[arg(long)]
        name: Option<String>,
    },

    /// Print the current shared settings.json
    Show,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        None => {
            let config = config::load_config()?;
            let has_profiles = !config.profiles.is_empty();

            if !has_profiles {
                return commands::onboarding::handle_onboarding();
            }

            if cli.no_tui {
                return commands::status::handle_status();
            }

            if is_tty_stdout() {
                return tui::render_dashboard();
            }

            commands::status::handle_status()
        }

        Some(Commands::Create { name, auth_type, tool, description }) => {
            commands::profile::handle_create(
                &name,
                auth_type.as_deref(),
                tool.as_deref(),
                description.as_deref(),
            )
        }

        Some(Commands::Use { name }) => commands::profile::handle_switch(&name),

        Some(Commands::List) => commands::profile::handle_list(),

        Some(Commands::Import { name, all, from, tool, force }) => {
            if all {
                let detected = detect::detect_tool_configs();
                if detected.is_empty() {
                    display::error("No tool configs detected. Nothing to import.");
                    std::process::exit(1);
                }
                for dt in detected {
                    commands::profile::handle_import(commands::profile::ImportOptions {
                        name: dt.tool.clone(),
                        from: Some(dt.config_dir.to_string_lossy().to_string()),
                        tool: Some(dt.tool),
                        force,
                    })?;
                }
                Ok(())
            } else {
                let profile_name = name.unwrap_or_else(|| "default".to_string());
                commands::profile::handle_import(commands::profile::ImportOptions {
                    name: profile_name,
                    from,
                    tool,
                    force,
                })
            }
        }

        Some(Commands::Dashboard) => tui::render_dashboard(),

        Some(Commands::Setup { shell, no_shell }) => {
            commands::setup::handle_setup(shell.as_deref(), no_shell)
        }

        Some(Commands::Update { shell, no_shell }) => {
            commands::setup::handle_update(shell.as_deref(), no_shell)
        }

        Some(Commands::Uninstall { force }) => commands::setup::handle_uninstall(force),

        Some(Commands::Doctor) => commands::doctor::handle_doctor(),

        Some(Commands::Launch { name, args }) => {
            let raw_args: Vec<String> = if let Some(ref n) = name {
                let mut v = vec![n.clone()];
                v.extend(args);
                v
            } else {
                args
            };
            commands::launch::handle_launch(name.as_deref(), &raw_args)
        }

        Some(Commands::SetKey { name, from_env }) => {
            commands::set_key::handle_set_key(name.as_deref(), from_env.as_deref())
        }

        Some(Commands::Status) => commands::status::handle_status(),

        Some(Commands::Profile { command }) => match command {
            ProfileCommands::Create { name, auth_type, tool, description } => {
                commands::profile::handle_create(
                    &name,
                    auth_type.as_deref(),
                    tool.as_deref(),
                    description.as_deref(),
                )
            }
            ProfileCommands::List => commands::profile::handle_list(),
            ProfileCommands::Show { name } => commands::profile::handle_show(name.as_deref()),
            ProfileCommands::Switch { name } => commands::profile::handle_switch(&name),
            ProfileCommands::Delete { name } => commands::profile::handle_delete(&name),
            ProfileCommands::Import { name, from, tool, force } => {
                commands::profile::handle_import(commands::profile::ImportOptions {
                    name,
                    from,
                    tool,
                    force,
                })
            }
        },

        Some(Commands::Shared { command }) => match command {
            SharedCommands::Status => commands::shared::handle_shared_status(),
            SharedCommands::Enable { name, memory, projects, claude_md } => {
                commands::shared::handle_shared_enable(
                    name.as_deref(),
                    commands::shared::SharedEnableOptions {
                        memory: if memory { Some(true) } else { None },
                        projects: if projects { Some(true) } else { None },
                        claude_md: if claude_md { Some(true) } else { None },
                    },
                )
            }
            SharedCommands::Disable { name, memory, projects } => {
                commands::shared::handle_shared_disable(name.as_deref(), memory, projects)
            }
            SharedCommands::Sync { all, name } => {
                commands::shared::handle_shared_sync(all, name.as_deref())
            }
            SharedCommands::Show => commands::shared::handle_shared_show(),
        },

        Some(Commands::Exec { name, args }) => {
            let raw_args: Vec<String> = if let Some(ref n) = name {
                let mut v = vec![n.clone()];
                v.extend(args);
                v
            } else {
                args
            };
            commands::exec::handle_exec(name.as_deref(), &raw_args)
        }

        Some(Commands::Shell { name }) => commands::shell::handle_shell(name.as_deref()),

        Some(Commands::ShellInit { shell }) => {
            commands::shell_init::handle_shell_init(shell.as_deref())
        }

        Some(Commands::Prune { force }) => commands::prune::handle_prune(force),

        Some(Commands::ResolveConfigDir) => commands::resolve::handle_resolve_config_dir(),
    }
}

fn is_tty_stdout() -> bool {
    #[cfg(unix)]
    {
        extern "C" {
            fn isatty(fd: i32) -> i32;
        }
        unsafe { isatty(1) != 0 }
    }
    #[cfg(not(unix))]
    {
        std::env::var("TERM").is_ok() || std::env::var("PROMPT").is_ok()
    }
}

