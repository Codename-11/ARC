use anyhow::Result;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::Path;

use crate::config::{load_config, resolve_name, save_config};
use crate::display::{self, profile_table, ProfileRow};
use crate::paths::{get_claude_default_dir, get_profile_dir};
use crate::types::{AuthType, Profile};

const MAX_NAME_LENGTH: usize = 32;

fn validate_profile_name(name: &str) -> Option<String> {
    if name.is_empty() {
        return Some("Profile name cannot be empty.".to_string());
    }
    if name.len() > MAX_NAME_LENGTH {
        return Some(format!(
            "Profile name must be {} characters or less.",
            MAX_NAME_LENGTH
        ));
    }
    let valid = name
        .chars()
        .next()
        .map(|c| c.is_alphanumeric())
        .unwrap_or(false)
        && name.chars().all(|c| c.is_alphanumeric() || c == '-');
    if !valid {
        return Some(
            "Profile name must be alphanumeric with hyphens only (no spaces or special characters). Must start with a letter or number.".to_string(),
        );
    }
    None
}

fn prompt_auth_type() -> AuthType {
    println!("Select authentication type:");
    println!("  1) oauth     - OAuth (claude.ai account)");
    println!("  2) api-key   - API Key (Anthropic / provider API)");
    println!("  3) bedrock   - AWS Bedrock");
    println!("  4) vertex    - Google Vertex AI");
    println!("  5) foundry   - Foundry");
    print!("Choice [1]: ");
    let _ = io::stdout().flush();

    let stdin = io::stdin();
    let mut line = String::new();
    if stdin.lock().read_line(&mut line).is_ok() {
        match line.trim() {
            "1" | "" => AuthType::OAuth,
            "2" => AuthType::ApiKey,
            "3" => AuthType::Bedrock,
            "4" => AuthType::Vertex,
            "5" => AuthType::Foundry,
            _ => AuthType::OAuth,
        }
    } else {
        AuthType::OAuth
    }
}

fn prompt_description() -> Option<String> {
    print!("Profile description (optional): ");
    let _ = io::stdout().flush();

    let stdin = io::stdin();
    let mut line = String::new();
    if stdin.lock().read_line(&mut line).is_ok() {
        let trimmed = line.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    } else {
        None
    }
}

pub fn handle_create(
    name: &str,
    auth_type: Option<&str>,
    tool: Option<&str>,
    description: Option<&str>,
) -> Result<()> {
    if let Some(err) = validate_profile_name(name) {
        display::error(&err);
        std::process::exit(1);
    }

    let mut config = load_config()?;

    if config.profiles.contains_key(name) {
        display::error(&format!("Profile \"{}\" already exists.", name));
        std::process::exit(1);
    }

    let resolved_auth_type = if let Some(at) = auth_type {
        match at.parse::<AuthType>() {
            Ok(t) => t,
            Err(e) => {
                display::error(&e.to_string());
                std::process::exit(1);
            }
        }
    } else {
        prompt_auth_type()
    };

    let resolved_description = description
        .map(|s| s.to_string())
        .or_else(|| prompt_description());
    let resolved_tool = tool.unwrap_or("claude").to_string();

    let profile_dir = get_profile_dir(name);
    fs::create_dir_all(&profile_dir)?;

    let is_first_profile = config.profiles.is_empty();

    config.profiles.insert(
        name.to_string(),
        Profile {
            auth_type: resolved_auth_type.clone(),
            tool: Some(resolved_tool.clone()),
            config_dir: profile_dir.to_string_lossy().to_string(),
            description: resolved_description,
            created_at: crate::shared::chrono_now_iso_pub(),
            api_key_storage: None,
            env_overrides: None,
            use_shared: None,
            use_shared_memory: None,
            use_shared_projects: None,
            launch_args: None,
        },
    );

    if is_first_profile {
        config.active_profile = name.to_string();
    }

    save_config(&config)?;

    display::success(&format!("Profile \"{}\" created.", name));
    display::info(&format!("Tool:             {}", resolved_tool));
    display::info(&format!(
        "Config directory: {}",
        profile_dir.to_string_lossy()
    ));

    if is_first_profile {
        display::info("Set as active profile.");
    }

    match resolved_auth_type {
        AuthType::OAuth => {
            display::info(&format!(
                "Run \"arc launch {}\" to start {} and sign in.",
                name, resolved_tool
            ));
        }
        AuthType::ApiKey => {
            display::info(&format!(
                "Run \"arc set-key {}\" to store your API key.",
                name
            ));
        }
        _ => {}
    }

    Ok(())
}

pub fn handle_list() -> Result<()> {
    let config = load_config()?;
    let names: Vec<String> = config.profiles.keys().cloned().collect();

    if names.is_empty() {
        display::info(
            "No profiles configured. Run \"arc profile create <name>\" to get started.",
        );
        return Ok(());
    }

    let rows: Vec<ProfileRow> = names
        .iter()
        .map(|name| {
            let p = &config.profiles[name];
            ProfileRow {
                name: name.clone(),
                active: name == &config.active_profile,
                auth_type: p.auth_type.to_string(),
                description: p.description.clone(),
            }
        })
        .collect();

    let table = profile_table(&rows);
    println!("{}", table);
    Ok(())
}

pub fn handle_show(name: Option<&str>) -> Result<()> {
    let config = load_config()?;
    let resolved = resolve_name(&config, name);
    let profile = config.profiles.get(resolved);

    match profile {
        None => {
            display::error(&format!("Profile \"{}\" not found.", resolved));
            std::process::exit(1);
        }
        Some(p) => {
            let is_active = resolved == config.active_profile;
            println!(
                "Name:        {}{}",
                resolved,
                if is_active { " (active)" } else { "" }
            );
            println!("Tool:        {}", p.tool.as_deref().unwrap_or("claude"));
            println!("Auth Type:   {}", p.auth_type);
            println!("Config Dir:  {}", p.config_dir);
            if let Some(desc) = &p.description {
                println!("Description: {}", desc);
            }
            println!("Created:     {}", p.created_at);
            if let Some(overrides) = &p.env_overrides {
                if !overrides.is_empty() {
                    println!("Env Overrides:");
                    for (key, value) in overrides {
                        println!("  {}={}", key, value);
                    }
                }
            }
        }
    }
    Ok(())
}

pub fn handle_switch(name: &str) -> Result<()> {
    let mut config = load_config()?;

    if !config.profiles.contains_key(name) {
        display::error(&format!("Profile \"{}\" not found.", name));
        std::process::exit(1);
    }

    config.active_profile = name.to_string();
    save_config(&config)?;
    display::success(&format!("Switched to profile \"{}\".", name));
    Ok(())
}

pub fn handle_delete(name: &str) -> Result<()> {
    let mut config = load_config()?;

    if !config.profiles.contains_key(name) {
        display::error(&format!("Profile \"{}\" not found.", name));
        std::process::exit(1);
    }

    if config.profiles.len() <= 1 {
        display::error("Cannot delete the only remaining profile.");
        std::process::exit(1);
    }

    let profile_dir = config.profiles[name].config_dir.clone();
    config.profiles.remove(name);

    if config.active_profile == name {
        let remaining = config.profiles.keys().next().cloned().unwrap_or_default();
        display::info(&format!(
            "Active profile switched to \"{}\".",
            remaining
        ));
        config.active_profile = remaining;
    }

    save_config(&config)?;

    // Remove profile directory (best effort)
    let dir_path = std::path::PathBuf::from(&profile_dir);
    if dir_path.exists() {
        let _ = fs::remove_dir_all(&dir_path);
    }

    display::success(&format!("Profile \"{}\" deleted.", name));
    Ok(())
}

// Files to skip during import
const IMPORT_SKIP: &[&str] = &[
    "cache",
    "debug",
    "telemetry",
    "statsig",
    "usage-data",
    "shell-snapshots",
    "paste-cache",
    "file-history",
    "chrome",
    "downloads",
    "projects",
    "tasks",
    "teams",
    "todos",
    "plans",
    "history.jsonl",
    ".update.lock",
    "stats-cache.json",
];

fn should_copy_entry(name: &str) -> bool {
    if IMPORT_SKIP.contains(&name) {
        return false;
    }
    if name.contains(".backup.") {
        return false;
    }
    true
}

fn detect_auth_type(source_dir: &Path) -> AuthType {
    // Check environment-based auth types first
    if std::env::var("AWS_PROFILE").is_ok()
        || std::env::var("AWS_ACCESS_KEY_ID").is_ok()
        || std::env::var("CLAUDE_CODE_USE_BEDROCK").as_deref() == Ok("1")
    {
        return AuthType::Bedrock;
    }
    if std::env::var("GOOGLE_APPLICATION_CREDENTIALS").is_ok()
        || std::env::var("CLAUDE_CODE_USE_VERTEX").as_deref() == Ok("1")
    {
        return AuthType::Vertex;
    }
    if std::env::var("FOUNDRY_API_KEY").is_ok() {
        return AuthType::Foundry;
    }

    // Check file-based auth indicators
    if source_dir.join(".api-key").exists() {
        return AuthType::ApiKey;
    }

    if let Ok(raw) = fs::read_to_string(source_dir.join(".credentials.json")) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
            if parsed.get("accessToken").is_some() || parsed.get("refreshToken").is_some() {
                return AuthType::OAuth;
            }
        }
    }

    AuthType::OAuth
}

pub struct ImportOptions {
    pub name: String,
    pub from: Option<String>,
    pub tool: Option<String>,
    pub force: bool,
}

pub fn handle_import(opts: ImportOptions) -> Result<()> {
    let tool = opts.tool.as_deref().unwrap_or("claude").to_string();
    let source_dir = opts
        .from
        .as_deref()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(get_claude_default_dir);
    let profile_name = opts.name.clone();

    if let Some(err) = validate_profile_name(&profile_name) {
        display::error(&err);
        std::process::exit(1);
    }

    if !source_dir.exists() {
        display::error(&format!(
            "Source directory does not exist: {}",
            source_dir.display()
        ));
        std::process::exit(1);
    }

    let entries: Vec<fs::DirEntry> = fs::read_dir(&source_dir)?
        .flatten()
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(should_copy_entry)
                .unwrap_or(false)
        })
        .collect();

    if entries.is_empty() {
        display::error(&format!(
            "Source directory does not contain any importable files: {}",
            source_dir.display()
        ));
        std::process::exit(1);
    }

    let mut config = load_config()?;

    if config.profiles.contains_key(&profile_name) && !opts.force {
        display::error(&format!(
            "Profile \"{}\" already exists. Use --force to overwrite.",
            profile_name
        ));
        std::process::exit(1);
    }

    let profile_dir = get_profile_dir(&profile_name);
    if opts.force && profile_dir.exists() {
        fs::remove_dir_all(&profile_dir)?;
    }
    fs::create_dir_all(&profile_dir)?;

    let auth_type = detect_auth_type(&source_dir);

    // Copy all config files and directories
    let mut copied_items: Vec<String> = Vec::new();
    for entry in &entries {
        let src_path = entry.path();
        let file_name = entry.file_name();
        let dest_path = profile_dir.join(&file_name);

        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
            copied_items.push(format!("{}/", file_name.to_string_lossy()));
        } else {
            fs::copy(&src_path, &dest_path)?;
            #[cfg(unix)]
            if file_name.to_str() == Some(".credentials.json") {
                use std::os::unix::fs::PermissionsExt;
                let perms = fs::Permissions::from_mode(0o600);
                let _ = fs::set_permissions(&dest_path, perms);
            }
            copied_items.push(file_name.to_string_lossy().to_string());
        }
    }

    // Claude Code: handle .claude.json
    if tool == "claude" && !copied_items.contains(&".claude.json".to_string()) {
        let claude_json_in_source = source_dir.join(".claude.json");
        let claude_json_in_home = dirs::home_dir()
            .unwrap_or_default()
            .join(".claude.json");

        let src = if claude_json_in_source.exists() {
            Some(claude_json_in_source)
        } else if claude_json_in_home.exists() {
            Some(claude_json_in_home)
        } else {
            None
        };

        if let Some(src_path) = src {
            let dest_path = profile_dir.join(".claude.json");
            fs::copy(&src_path, &dest_path)?;
            copied_items.push(".claude.json".to_string());
        }
    }

    let had_no_profiles = config.profiles.is_empty();

    config.profiles.insert(
        profile_name.clone(),
        Profile {
            auth_type,
            tool: Some(tool.clone()),
            config_dir: profile_dir.to_string_lossy().to_string(),
            description: Some(format!("Imported from {}", source_dir.display())),
            created_at: crate::shared::chrono_now_iso_pub(),
            api_key_storage: None,
            env_overrides: None,
            use_shared: None,
            use_shared_memory: None,
            use_shared_projects: None,
            launch_args: None,
        },
    );

    if had_no_profiles {
        config.active_profile = profile_name.clone();
    }

    save_config(&config)?;

    display::success(&format!(
        "Profile \"{}\" imported from {}",
        profile_name,
        source_dir.display()
    ));
    display::detail(&format!("Tool:   {}", tool));
    display::detail(&format!("Copied: {}", copied_items.join(", ")));
    display::detail(&format!("Config: {}", profile_dir.display()));

    Ok(())
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)?.flatten() {
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        } else {
            fs::copy(&src_path, &dest_path)?;
        }
    }
    Ok(())
}
