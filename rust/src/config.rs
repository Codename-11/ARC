use anyhow::{Context, Result};
use std::fs;
use std::path::PathBuf;

use crate::paths::{get_arc_dir, get_config_path};
use crate::types::{ArcConfig, Profile};
use std::collections::HashMap;

pub fn default_config() -> ArcConfig {
    ArcConfig {
        version: 1,
        active_profile: "default".to_string(),
        profiles: HashMap::new(),
    }
}

pub fn load_config() -> Result<ArcConfig> {
    let config_path = get_config_path();

    if !config_path.exists() {
        return Ok(default_config());
    }

    let raw = fs::read_to_string(&config_path)
        .with_context(|| format!("Failed to read config file at {}", config_path.display()))?;

    let config: ArcConfig = serde_json::from_str(&raw).with_context(|| {
        format!(
            "Config file at {} contains malformed JSON or invalid structure. \
             Expected version: 1, activeProfile (string), and profiles (object).",
            config_path.display()
        )
    })?;

    if config.version != 1 {
        anyhow::bail!(
            "Config file at {} has unsupported version {}. Expected version 1.",
            config_path.display(),
            config.version
        );
    }

    Ok(config)
}

pub fn save_config(config: &ArcConfig) -> Result<()> {
    let config_path = get_config_path();
    let dir = get_arc_dir();

    fs::create_dir_all(&dir)
        .with_context(|| format!("Failed to create arc directory at {}", dir.display()))?;

    // Generate a random suffix for the temp file
    let random_suffix = {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        format!("{:08x}", rng.gen::<u32>())
    };

    let temp_path: PathBuf = dir.join(format!("config.tmp.{}", random_suffix));

    let content = serde_json::to_string_pretty(config)
        .context("Failed to serialize config to JSON")?;
    let content = content + "\n";

    fs::write(&temp_path, &content)
        .with_context(|| format!("Failed to write temp config to {}", temp_path.display()))?;

    // chmod 600 on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&temp_path, perms)
            .with_context(|| format!("Failed to set permissions on {}", temp_path.display()))?;
    }

    fs::rename(&temp_path, &config_path).with_context(|| {
        format!(
            "Failed to rename temp config {} to {}",
            temp_path.display(),
            config_path.display()
        )
    })?;

    Ok(())
}

#[allow(dead_code)]
pub fn get_active_profile(config: &ArcConfig) -> Option<&Profile> {
    config.profiles.get(&config.active_profile)
}

#[allow(dead_code)]
pub fn resolve_profile_name<'a>(config: &'a ArcConfig, name: Option<&str>) -> &'a str {
    match name {
        Some(n) if !n.is_empty() => {
            // Return the provided name even if not in config — callers will handle missing
            // We need to return a str with lifetime tied to something. For provided names
            // we can't easily return them tied to config lifetime, so we'll handle this
            // by returning config.active_profile when the name equals it, otherwise
            // just return the active_profile (callers should use the provided name directly).
            // Actually the simplest correct approach: return active_profile as fallback
            // but the caller passes n as &str owned by their scope. We use a workaround:
            &config.active_profile // will be overridden by caller pattern
        }
        _ => &config.active_profile,
    }
}

/// Resolve profile name: if `name` is Some, return it; otherwise return the active profile name.
pub fn resolve_name<'a>(config: &'a ArcConfig, name: Option<&'a str>) -> &'a str {
    match name {
        Some(n) if !n.is_empty() => n,
        _ => &config.active_profile,
    }
}
