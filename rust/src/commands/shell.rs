use anyhow::Result;
use std::process::Command;

use crate::auth::build_profile_env;
use crate::config::{load_config, resolve_name};
use crate::display;

pub fn handle_shell(name: Option<&str>) -> Result<()> {
    let config = load_config()?;
    let profile_name = resolve_name(&config, name).to_string();
    let profile = config.profiles.get(&profile_name).cloned();

    let profile = match profile {
        None => {
            display::error(&format!(
                "Profile \"{}\" not found. Run \"arc profile list\" to see available profiles.",
                profile_name
            ));
            std::process::exit(1);
        }
        Some(p) => p,
    };

    let profile_env = build_profile_env(&profile, &profile_name)?;

    let shell_cmd = if cfg!(windows) {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    };

    display::info(&format!(
        "Entering arc shell for profile: {}. Type 'exit' to return.",
        profile_name
    ));

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

    let status = Command::new(&shell_cmd)
        .envs(&env_vars)
        .status()?;

    std::process::exit(status.code().unwrap_or(0));
}
