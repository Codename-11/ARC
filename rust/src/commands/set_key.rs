use anyhow::Result;
use std::io::{self, BufRead, Write};

use crate::config::{load_config, resolve_name, save_config};
use crate::display::{self, redact};
use crate::keyring::store_secret;
use crate::types::AuthType;

fn read_key_interactive() -> Option<String> {
    // Simple stdin prompt (no echo disable in this implementation)
    print!("Enter API key: ");
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

fn read_key_from_stdin() -> String {
    let stdin = io::stdin();
    let mut data = String::new();
    for line in stdin.lock().lines().flatten() {
        data.push_str(&line);
        data.push('\n');
    }
    data.trim().to_string()
}

fn validate_key_format(key: &str) -> bool {
    key.starts_with("sk-ant-") || key.starts_with("sk-") || key.len() > 20
}

fn is_tty() -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        unsafe { libc_isatty(io::stdin().as_raw_fd()) }
    }
    #[cfg(not(unix))]
    {
        // On Windows, assume TTY if running interactively
        // We use a simple check by trying to get console info
        is_windows_tty()
    }
}

#[cfg(unix)]
fn libc_isatty(fd: i32) -> bool {
    extern "C" {
        fn isatty(fd: i32) -> i32;
    }
    unsafe { isatty(fd) != 0 }
}

#[cfg(not(unix))]
fn is_windows_tty() -> bool {
    // On Windows, check if we can detect a console
    std::env::var("TERM").is_ok() || std::env::var("PROMPT").is_ok()
}

pub fn handle_set_key(name: Option<&str>, from_env: Option<&str>) -> Result<()> {
    let mut config = load_config()?;
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

    if profile.auth_type != AuthType::ApiKey {
        display::error(&format!(
            "Profile \"{}\" uses auth type \"{}\". set-key is only for api-key profiles.",
            profile_name, profile.auth_type
        ));
        std::process::exit(1);
    }

    let api_key: Option<String> = if let Some(env_var) = from_env {
        let val = std::env::var(env_var).unwrap_or_default();
        if val.is_empty() {
            display::error(&format!(
                "Environment variable \"{}\" is not set.",
                env_var
            ));
            std::process::exit(1);
        }
        Some(val)
    } else if !is_tty() {
        Some(read_key_from_stdin())
    } else {
        read_key_interactive()
    };

    let api_key = match api_key {
        None => {
            display::error("No API key provided.");
            std::process::exit(1);
        }
        Some(k) => k,
    };

    if !validate_key_format(&api_key) {
        display::error(
            "Invalid API key format. Expected a key starting with 'sk-ant-' or 'sk-'.",
        );
        std::process::exit(1);
    }

    store_secret(&profile_name, &api_key)?;

    if let Some(p) = config.profiles.get_mut(&profile_name) {
        p.api_key_storage = Some("keyring".to_string());
    }
    save_config(&config)?;

    display::success(&format!(
        "API key stored for profile: {} ({})",
        profile_name,
        redact(&api_key)
    ));
    Ok(())
}
