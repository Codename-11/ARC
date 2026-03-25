use std::path::PathBuf;

/// Returns the arc data directory. Respects the `ARC_DIR` environment variable,
/// falling back to `~/.arc`.
pub fn get_arc_dir() -> PathBuf {
    if let Ok(env_dir) = std::env::var("ARC_DIR") {
        if !env_dir.is_empty() {
            return PathBuf::from(env_dir);
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".arc")
}

pub fn get_config_path() -> PathBuf {
    get_arc_dir().join("config.json")
}

#[allow(dead_code)]
pub fn get_profiles_dir() -> PathBuf {
    get_arc_dir().join("profiles")
}

pub fn get_profile_dir(name: &str) -> PathBuf {
    get_arc_dir().join("profiles").join(name)
}

pub fn get_shared_dir() -> PathBuf {
    get_arc_dir().join("shared")
}

pub fn get_shared_settings_path() -> PathBuf {
    get_shared_dir().join("settings.json")
}

pub fn get_shared_commands_dir() -> PathBuf {
    get_shared_dir().join("commands")
}

pub fn get_shared_claude_md_path() -> PathBuf {
    get_shared_dir().join("CLAUDE.md")
}

pub fn get_shared_memory_dir() -> PathBuf {
    get_shared_dir().join("memory")
}

pub fn get_shared_projects_dir() -> PathBuf {
    get_shared_dir().join("projects")
}

pub fn get_claude_default_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
}
