use anyhow::Result;
use colored::Colorize;
use std::fs;
use std::io::{self, BufRead, Write};

use crate::config::load_config;
use crate::display::{self, section_header};
use crate::keyring::delete_secret;
use crate::paths::get_arc_dir;

pub fn handle_prune(force: bool) -> Result<()> {
    let arc_dir = get_arc_dir();

    if !arc_dir.exists() {
        display::error("Nothing to remove. No arc data directory found.");
        return Ok(());
    }

    // Discover profile names
    let profile_names: Vec<String> = load_config()
        .ok()
        .map(|c| c.profiles.keys().cloned().collect())
        .unwrap_or_default();

    // Show what will be removed
    println!();
    section_header("Prune");
    println!();
    println!(
        "  This will permanently remove {} arc data:",
        "all".bold()
    );
    println!();
    display::detail(&format!("Directory: {}", arc_dir.display()));
    if !profile_names.is_empty() {
        display::detail(&format!("Profiles:  {}", profile_names.join(", ")));
        display::detail("Keyring:   OS keyring entries for each profile");
    }
    println!();

    // Confirm
    if !force {
        if !confirm_prompt("Are you sure? This cannot be undone.")? {
            println!();
            display::warn("Aborted.");
            return Ok(());
        }
    }

    // 1. Clear OS keyring entries
    for name in &profile_names {
        delete_secret(name);
    }

    // 2. Remove the entire arc directory
    fs::remove_dir_all(&arc_dir).map_err(|e| {
        display::error(&format!("Failed to remove {}: {}", arc_dir.display(), e));
        anyhow::anyhow!("Failed to remove arc directory: {}", e)
    })?;

    println!();
    display::success("All arc data has been removed.");
    if !profile_names.is_empty() {
        display::detail(&format!(
            "Removed {} profile(s): {}",
            profile_names.len(),
            profile_names.join(", ")
        ));
    }
    display::detail(&format!("Deleted: {}", arc_dir.display()));
    println!();

    Ok(())
}

fn confirm_prompt(message: &str) -> Result<bool> {
    print!("{} (y/N): ", message);
    let _ = io::stdout().flush();

    let stdin = io::stdin();
    let mut line = String::new();
    if stdin.lock().read_line(&mut line).is_ok() {
        let answer = line.trim().to_lowercase();
        Ok(answer == "y" || answer == "yes")
    } else {
        Ok(false)
    }
}
