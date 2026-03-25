use anyhow::Result;
use std::path::Path;

use crate::config::{load_config, resolve_name, save_config};
use crate::display::{self, section_header};
use crate::paths::{
    get_shared_claude_md_path, get_shared_commands_dir, get_shared_dir, get_shared_memory_dir,
    get_shared_projects_dir, get_shared_settings_path,
};
use crate::shared::{
    get_shared_manifest, get_shared_settings, sync_shared_to_profile,
    unsync_shared_from_profile, SyncOptions,
};

pub fn handle_shared_status() -> Result<()> {
    let config = load_config()?;
    let shared_dir = get_shared_dir();
    let shared_settings = get_shared_settings();

    println!();
    section_header("Shared Layer");
    println!();

    if !shared_dir.exists() {
        display::info(&format!("No shared layer at {}", shared_dir.display()));
        display::info("Add a settings.json or commands/ there, then run \"arc shared enable\".");
        println!();
        return Ok(());
    }

    // MCP servers
    let mcp_servers = shared_settings
        .as_ref()
        .and_then(|s| s.get("mcpServers"))
        .and_then(|v| v.as_object());

    if let Some(mcp) = mcp_servers {
        if !mcp.is_empty() {
            display::info("MCP servers:");
            for name in mcp.keys() {
                display::detail(name);
            }
        } else {
            display::info("No shared MCP servers configured.");
        }
    } else {
        display::info("No shared MCP servers configured.");
    }

    // Commands
    let shared_commands_dir = get_shared_commands_dir();
    if shared_commands_dir.exists() {
        let files: Vec<String> = std::fs::read_dir(&shared_commands_dir)?
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();
        if !files.is_empty() {
            println!();
            display::info("Shared commands:");
            for f in &files {
                display::detail(f);
            }
        }
    }

    // CLAUDE.md
    let shared_claude_md = get_shared_claude_md_path();
    if shared_claude_md.exists() {
        println!();
        display::info(&format!("Shared CLAUDE.md: {}", shared_claude_md.display()));
    }

    // memory/
    let shared_memory = get_shared_memory_dir();
    if shared_memory.exists() {
        println!();
        display::info(&format!("Shared memory dir: {}", shared_memory.display()));
    }

    // projects/
    let shared_projects = get_shared_projects_dir();
    if shared_projects.exists() {
        println!();
        display::info(&format!("Shared projects dir: {}", shared_projects.display()));
    }

    // Per-profile status
    println!();
    section_header("Profiles");
    println!();

    for (name, profile) in &config.profiles {
        let enabled = profile.use_shared == Some(true);
        if enabled {
            let manifest = get_shared_manifest(Path::new(&profile.config_dir));
            let synced_at = manifest
                .as_ref()
                .map(|m| m.synced_at.clone())
                .unwrap_or_else(|| "never".to_string());
            let mut extras: Vec<&str> = Vec::new();
            if manifest.as_ref().and_then(|m| m.claude_md).unwrap_or(false) {
                extras.push("CLAUDE.md");
            }
            if manifest.as_ref().and_then(|m| m.memory_linked).unwrap_or(false) {
                extras.push("memory linked");
            }
            if manifest.as_ref().and_then(|m| m.projects_linked).unwrap_or(false) {
                extras.push("projects linked");
            }
            let extras_str = if extras.is_empty() {
                String::new()
            } else {
                format!("  [{}]", extras.join(", "))
            };
            display::detail(&format!(
                "{}  enabled  (last sync: {}){}",
                name, synced_at, extras_str
            ));
        } else {
            display::detail(&format!("{}  disabled", name));
        }
    }
    println!();

    Ok(())
}

pub struct SharedEnableOptions {
    pub memory: Option<bool>,
    pub projects: Option<bool>,
    pub claude_md: Option<bool>,
}

pub fn handle_shared_enable(name: Option<&str>, opts: SharedEnableOptions) -> Result<()> {
    let mut config = load_config()?;
    let profile_name = resolve_name(&config, name).to_string();

    let profile = config.profiles.get(&profile_name).cloned();
    let mut profile = match profile {
        None => {
            display::error(&format!("Profile \"{}\" not found.", profile_name));
            std::process::exit(1);
        }
        Some(p) => p,
    };

    if profile.use_shared == Some(true) {
        display::info(&format!(
            "Shared layer already enabled for \"{}\" — re-syncing...",
            profile_name
        ));
    }

    profile.use_shared = Some(true);
    if let Some(m) = opts.memory {
        profile.use_shared_memory = Some(m);
    }
    if let Some(p) = opts.projects {
        profile.use_shared_projects = Some(p);
    }

    let config_dir = profile.config_dir.clone();
    let use_shared_memory = profile.use_shared_memory;
    let use_shared_projects = profile.use_shared_projects;

    config.profiles.insert(profile_name.clone(), profile);
    save_config(&config)?;

    sync_shared_to_profile(
        Path::new(&config_dir),
        SyncOptions {
            claude_md: opts.claude_md,
            memory: use_shared_memory,
            projects: use_shared_projects,
        },
    )?;

    display::success(&format!(
        "Shared layer enabled and synced for profile \"{}\".",
        profile_name
    ));
    Ok(())
}

pub fn handle_shared_disable(
    name: Option<&str>,
    memory_only: bool,
    projects_only: bool,
) -> Result<()> {
    let mut config = load_config()?;
    let profile_name = resolve_name(&config, name).to_string();

    let profile = config.profiles.get(&profile_name).cloned();
    let mut profile = match profile {
        None => {
            display::error(&format!("Profile \"{}\" not found.", profile_name));
            std::process::exit(1);
        }
        Some(p) => p,
    };

    let disable_specific = memory_only || projects_only;

    if disable_specific {
        if profile.use_shared != Some(true) {
            display::info(&format!(
                "Shared layer is not enabled for \"{}\".",
                profile_name
            ));
            return Ok(());
        }
        if memory_only {
            profile.use_shared_memory = Some(false);
        }
        if projects_only {
            profile.use_shared_projects = Some(false);
        }
        let config_dir = profile.config_dir.clone();
        let use_shared_memory = profile.use_shared_memory;
        let use_shared_projects = profile.use_shared_projects;
        config.profiles.insert(profile_name.clone(), profile);
        save_config(&config)?;
        sync_shared_to_profile(
            Path::new(&config_dir),
            SyncOptions {
                claude_md: None,
                memory: use_shared_memory,
                projects: use_shared_projects,
            },
        )?;
        display::success(&format!(
            "Updated shared layer for profile \"{}\".",
            profile_name
        ));
        return Ok(());
    }

    if profile.use_shared != Some(true) {
        display::info(&format!(
            "Shared layer is not enabled for \"{}\".",
            profile_name
        ));
        return Ok(());
    }

    let config_dir = profile.config_dir.clone();
    unsync_shared_from_profile(Path::new(&config_dir))?;

    profile.use_shared = Some(false);
    profile.use_shared_memory = Some(false);
    profile.use_shared_projects = Some(false);
    config.profiles.insert(profile_name.clone(), profile);
    save_config(&config)?;

    display::success(&format!(
        "Shared layer disabled and unsynced for profile \"{}\".",
        profile_name
    ));
    Ok(())
}

pub fn handle_shared_sync(all: bool, profile_name_opt: Option<&str>) -> Result<()> {
    let config = load_config()?;

    let targets: Vec<(String, String, Option<bool>, Option<bool>)> = if all {
        config
            .profiles
            .iter()
            .filter(|(_, p)| p.use_shared == Some(true))
            .map(|(n, p)| {
                (
                    n.clone(),
                    p.config_dir.clone(),
                    p.use_shared_memory,
                    p.use_shared_projects,
                )
            })
            .collect()
    } else {
        let profile_name = resolve_name(&config, profile_name_opt).to_string();
        let profile = config.profiles.get(&profile_name);
        match profile {
            None => {
                display::error(&format!("Profile \"{}\" not found.", profile_name));
                std::process::exit(1);
            }
            Some(p) => {
                if p.use_shared != Some(true) {
                    display::warn(&format!(
                        "Shared layer is not enabled for \"{}\". Run \"arc shared enable {}\" first.",
                        profile_name, profile_name
                    ));
                    std::process::exit(1);
                }
                vec![(
                    profile_name.clone(),
                    p.config_dir.clone(),
                    p.use_shared_memory,
                    p.use_shared_projects,
                )]
            }
        }
    };

    if targets.is_empty() {
        display::info("No profiles have the shared layer enabled.");
        return Ok(());
    }

    for (name, config_dir, memory, projects) in targets {
        sync_shared_to_profile(
            Path::new(&config_dir),
            SyncOptions {
                claude_md: None,
                memory,
                projects,
            },
        )?;
        display::success(&format!("Synced shared layer to \"{}\".", name));
    }

    Ok(())
}

pub fn handle_shared_show() -> Result<()> {
    let shared_settings = get_shared_settings();
    let shared_settings_path = get_shared_settings_path();

    match shared_settings {
        None => {
            display::info("No shared settings found.");
            display::info(&format!(
                "Create {} to get started.",
                shared_settings_path.display()
            ));
        }
        Some(settings) => {
            println!("{}", serde_json::to_string_pretty(&settings)?);
        }
    }

    Ok(())
}
