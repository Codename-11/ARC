use anyhow::Result;
use std::process::Command;

use crate::auth::build_profile_env;
use crate::config::load_config;
use crate::display;

/// Check whether a command binary is available on PATH.
pub fn find_binary(name: &str) -> bool {
    which::which(name).is_ok()
}

/// Suggest an install command for known agent tool binaries.
fn get_install_hint(tool: &str) -> String {
    match tool {
        "claude" => "Install with: npm install -g @anthropic-ai/claude-code".to_string(),
        "gemini" => "See Google's documentation for Gemini CLI installation instructions.".to_string(),
        "codex" => "Install with: npm install -g @openai/codex".to_string(),
        other => format!("Ensure \"{}\" is installed and available on your PATH.", other),
    }
}

pub fn handle_launch(name: Option<&str>, raw_args: &[String]) -> Result<()> {
    let config = load_config()?;

    let (profile_name, passthrough): (String, Vec<String>) = if let Some(n) = name {
        if config.profiles.contains_key(n) {
            // Valid profile name — everything after it is for the agent tool
            (n.to_string(), raw_args[1..].to_vec())
        } else {
            // Not a valid profile — treat everything as passthrough
            (config.active_profile.clone(), raw_args.to_vec())
        }
    } else {
        (config.active_profile.clone(), raw_args.to_vec())
    };

    // Strip leading -- separator
    let passthrough: Vec<String> = if passthrough.first().map(|s| s.as_str()) == Some("--") {
        passthrough[1..].to_vec()
    } else {
        passthrough
    };

    let profile = config.profiles.get(&profile_name);
    let profile = match profile {
        Some(p) => p,
        None => {
            display::error(&format!(
                "Profile \"{}\" not found. Run \"arc list\" to see available profiles.",
                profile_name
            ));
            std::process::exit(1);
        }
    };

    let tool = profile.tool.as_deref().unwrap_or("claude");
    let profile_env = build_profile_env(profile, &profile_name)?;

    if !find_binary(tool) {
        display::error(&format!("Binary \"{}\" not found on PATH.", tool));
        display::warn(&get_install_hint(tool));
        std::process::exit(1);
    }

    display::info(&format!(
        "Launching {} with profile: {}",
        tool, profile_name
    ));

    // Build the environment for the child process
    let mut env_vars: std::collections::HashMap<String, String> = std::env::vars().collect();
    for (key, value) in &profile_env {
        match value {
            Some(v) => {
                env_vars.insert(key.clone(), v.clone());
            }
            None => {
                env_vars.remove(key);
            }
        }
    }

    let status = Command::new(tool)
        .args(&passthrough)
        .envs(&env_vars)
        .status()?;

    std::process::exit(status.code().unwrap_or(0));
}
