use anyhow::Result;
use std::fs;
use std::path::PathBuf;

use crate::display;
use crate::paths::get_profile_dir;

pub const SERVICE_NAME: &str = "arc";

fn get_fallback_path(profile_name: &str) -> PathBuf {
    get_profile_dir(profile_name).join(".api-key")
}

fn write_fallback_file(file_path: &PathBuf, secret: &str) -> Result<()> {
    if let Some(dir) = file_path.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(file_path, secret)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        fs::set_permissions(file_path, perms)?;
    }

    Ok(())
}

pub fn store_secret(profile_name: &str, secret: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE_NAME, profile_name);
    match entry {
        Ok(e) => match e.set_password(secret) {
            Ok(_) => return Ok(()),
            Err(err) => {
                display::warn(&format!(
                    "Failed to store secret in OS keyring ({}). Falling back to plaintext file.",
                    err
                ));
            }
        },
        Err(err) => {
            display::warn(&format!(
                "OS keyring not available ({}). Storing API key in plaintext file.",
                err
            ));
        }
    }

    let fallback = get_fallback_path(profile_name);
    write_fallback_file(&fallback, secret).unwrap_or_else(|e| {
        display::warn(&format!("Failed to store secret in fallback file: {}", e));
    });

    Ok(())
}

pub fn retrieve_secret(profile_name: &str) -> Option<String> {
    // Try OS keyring first
    if let Ok(entry) = keyring::Entry::new(SERVICE_NAME, profile_name) {
        if let Ok(password) = entry.get_password() {
            return Some(password);
        }
    }

    // Fallback: read from file
    let fallback = get_fallback_path(profile_name);
    if fallback.exists() {
        match fs::read_to_string(&fallback) {
            Ok(content) => return Some(content),
            Err(e) => {
                display::warn(&format!(
                    "Failed to read secret from fallback file: {}",
                    e
                ));
            }
        }
    }

    None
}

pub fn delete_secret(profile_name: &str) {
    // Try OS keyring
    if let Ok(entry) = keyring::Entry::new(SERVICE_NAME, profile_name) {
        let _ = entry.delete_credential();
    }

    // Also remove fallback file if present
    let fallback = get_fallback_path(profile_name);
    if fallback.exists() {
        if let Err(e) = fs::remove_file(&fallback) {
            display::warn(&format!(
                "Failed to delete secret fallback file: {}",
                e
            ));
        }
    }
}
