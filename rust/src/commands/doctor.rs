use anyhow::Result;
use colored::Colorize;
use std::fs;
use std::path::Path;

use crate::auth::get_credential_status;
use crate::commands::launch::find_binary;
use crate::config::{load_config};
use crate::display::section_header;
use crate::paths::get_config_path;

fn check(msg: &str) {
    println!("  {} {}", "✔".green(), msg);
}

fn cross(msg: &str) {
    println!("  {} {}", "✖".red(), msg);
}

fn warning(msg: &str) {
    println!("  {} {}", "⚠".yellow(), msg);
}

fn check_config_file() -> bool {
    let config_path = get_config_path();

    if !config_path.exists() {
        cross(&format!("Config file not found at {}", config_path.display()));
        return false;
    }

    let raw = match fs::read_to_string(&config_path) {
        Ok(r) => r,
        Err(_) => {
            cross(&format!("Config file unreadable at {}", config_path.display()));
            return false;
        }
    };

    match serde_json::from_str::<crate::types::ArcConfig>(&raw) {
        Ok(cfg) if cfg.version == 1 => {
            check("Config file valid");
            true
        }
        _ => {
            cross("Config file contains malformed JSON or invalid structure");
            false
        }
    }
}

fn check_path() {
    let local_bin = dirs::home_dir()
        .unwrap_or_default()
        .join(".local")
        .join("bin");

    let path_env = std::env::var("PATH").unwrap_or_default();
    let separator = if cfg!(windows) { ";" } else { ":" };

    let on_path = path_env.split(separator).any(|d| {
        Path::new(d)
            .canonicalize()
            .ok()
            .zip(local_bin.canonicalize().ok())
            .map(|(a, b)| a == b)
            .unwrap_or_else(|| d == local_bin.to_string_lossy().as_ref())
    });

    if on_path {
        check("PATH includes ~/.local/bin");
    } else {
        warning("~/.local/bin is not on PATH");
    }
}

fn detect_shell_type() -> &'static str {
    if cfg!(windows) {
        return "powershell";
    }
    let shell_env = std::env::var("SHELL").unwrap_or_default();
    let base = Path::new(&shell_env)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    match base {
        "zsh" => "zsh",
        "fish" => "fish",
        _ => "bash",
    }
}

fn get_shell_profile_path(shell: &str) -> Option<std::path::PathBuf> {
    let home = dirs::home_dir()?;
    match shell {
        "powershell" => Some(home.join("Documents").join("PowerShell").join("Microsoft.PowerShell_profile.ps1")),
        "bash" => Some(home.join(".bashrc")),
        "zsh" => Some(home.join(".zshrc")),
        "fish" => Some(home.join(".config").join("fish").join("config.fish")),
        _ => None,
    }
}

fn check_shell_integration() {
    let shell = detect_shell_type();
    let profile_path = match get_shell_profile_path(shell) {
        Some(p) => p,
        None => {
            warning(&format!(
                "Could not determine shell profile path for {}",
                shell
            ));
            return;
        }
    };

    if !profile_path.exists() {
        warning(&format!("Shell profile not found: {}", profile_path.display()));
        return;
    }

    let content = match fs::read_to_string(&profile_path) {
        Ok(c) => c,
        Err(_) => {
            warning(&format!(
                "Could not read shell profile: {}",
                profile_path.display()
            ));
            return;
        }
    };

    if content.contains("arc shell-init") {
        check(&format!("Shell integration found in {}", profile_path.display()));
    } else {
        warning(&format!(
            "Shell integration not found in {}",
            profile_path.file_name().unwrap_or_default().to_string_lossy()
        ));
    }
}

fn format_expiry(expires_at_ms: i64) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let diff = expires_at_ms - now;
    let abs_diff = diff.unsigned_abs() as u64;
    let minutes = abs_diff / 60000;
    let hours = minutes / 60;
    let days = hours / 24;

    let time_str = if days > 0 {
        format!("{}d {}h", days, hours % 24)
    } else if hours > 0 {
        format!("{}h {}m", hours, minutes % 60)
    } else {
        format!("{}m", minutes)
    };

    if diff > 0 {
        format!("expires in {}", time_str)
    } else {
        format!("expired {} ago", time_str)
    }
}

fn check_profiles() {
    let config = match load_config() {
        Ok(c) => c,
        Err(_) => return,
    };

    let names: Vec<String> = config.profiles.keys().cloned().collect();
    if names.is_empty() {
        println!("  {}", "No profiles configured.".dimmed());
        return;
    }

    println!();
    println!("  {}", "Profiles:".bold());

    for name in &names {
        let profile = &config.profiles[name];
        let tool = profile.tool.as_deref().unwrap_or("claude");
        let is_active = name == &config.active_profile;
        let label = if is_active {
            format!("{}{}", name.bold(), " *".dimmed())
        } else {
            name.to_string()
        };
        println!(
            "    {} {}",
            label,
            format!("({} / {})", tool, profile.auth_type).dimmed()
        );

        // Binary check
        if find_binary(tool) {
            println!("      {} {} binary found", "✔".green(), tool);
        } else {
            println!("      {} {} binary not found", "✖".red(), tool);
        }

        // Credential check
        match get_credential_status(profile) {
            Ok(cred) => {
                if cred.authenticated {
                    let auth_msg = match cred.method.as_str() {
                        "oauth" => {
                            let expiry_info = cred
                                .expires_at
                                .map(|e| format!(" ({})", format_expiry(e)))
                                .unwrap_or_default();
                            format!("Authenticated{}", expiry_info)
                        }
                        "api-key" => "API key configured".to_string(),
                        "env-var" => "API key set via env var".to_string(),
                        "bedrock" => "Bedrock credentials configured".to_string(),
                        "vertex" => "Vertex credentials configured".to_string(),
                        "foundry" => "Foundry credentials configured".to_string(),
                        other => format!("Authenticated ({})", other),
                    };
                    println!("      {} {}", "✔".green(), auth_msg);
                } else if cred.expired == Some(true) {
                    let expiry_info = cred
                        .expires_at
                        .map(|e| format!(" ({})", format_expiry(e)))
                        .unwrap_or_default();
                    println!(
                        "      {} Credentials expired{}",
                        "⚠".yellow(),
                        expiry_info
                    );
                } else {
                    println!("      {} Not authenticated", "✖".red());
                }
            }
            Err(_) => {
                println!("      {} Error checking credentials", "✖".red());
            }
        }
    }
}

pub fn handle_doctor() -> Result<()> {
    println!();
    section_header("ARC Doctor");
    println!();

    check_config_file();
    check_path();
    check_shell_integration();
    check_profiles();

    println!();
    Ok(())
}
