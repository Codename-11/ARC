use anyhow::Result;
use std::process::Command;

use crate::auth::build_profile_env;
use crate::config::load_config;
use crate::display;

pub fn handle_exec(name: Option<&str>, raw_args: &[String]) -> Result<()> {
    let config = load_config()?;

    let (profile_name, passthrough): (String, Vec<String>) = if let Some(n) = name {
        if config.profiles.contains_key(n) {
            (n.to_string(), raw_args[1..].to_vec())
        } else {
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

    let profile = config.profiles.get(&profile_name).cloned();
    let profile = match profile {
        None => {
            display::error(&format!(
                "Profile \"{}\" not found. Run \"arc list\" to see available profiles.",
                profile_name
            ));
            std::process::exit(1);
        }
        Some(p) => p,
    };

    if passthrough.is_empty() {
        display::error(
            "No command specified.\n\nUsage:\n  arc exec [profile] <command...>\n\nExamples:\n  arc exec work node app.js\n  arc exec work npm test\n  arc exec -- npm test",
        );
        std::process::exit(1);
    }

    let profile_env = build_profile_env(&profile, &profile_name)?;

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

    let cmd = &passthrough[0];
    let args = &passthrough[1..];

    let status = Command::new(cmd)
        .args(args)
        .envs(&env_vars)
        .status()?;

    std::process::exit(status.code().unwrap_or(0));
}
