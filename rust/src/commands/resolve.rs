use anyhow::Result;
use std::io::Write;

use crate::config::load_config;

pub fn handle_resolve_config_dir() -> Result<()> {
    let profile_name_env = std::env::var("ARC_PROFILE").ok();

    let config = match load_config() {
        Ok(c) => c,
        Err(_) => std::process::exit(1),
    };

    let resolved = profile_name_env
        .as_deref()
        .unwrap_or(&config.active_profile);

    let profile = config.profiles.get(resolved);

    match profile {
        None => std::process::exit(1),
        Some(p) => {
            print!("{}", p.config_dir);
            let _ = std::io::stdout().flush();
            Ok(())
        }
    }
}
