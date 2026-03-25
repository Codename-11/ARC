use anyhow::Result;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

use crate::display::{self, section_header};

fn detect_shell() -> &'static str {
    if cfg!(windows) {
        return "powershell";
    }
    let shell_env = std::env::var("SHELL").unwrap_or_default();
    let base = std::path::Path::new(&shell_env)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    match base.as_str() {
        "zsh" => "zsh",
        "fish" => "fish",
        _ => "bash",
    }
}

fn get_user_bin_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("ARC_LOCAL_BIN_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local")
        .join("bin")
}

fn get_current_exe() -> Option<PathBuf> {
    std::env::current_exe().ok()
}

fn get_shell_profile_path(shell: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    match shell {
        "powershell" => Some(
            home.join("Documents")
                .join("PowerShell")
                .join("Microsoft.PowerShell_profile.ps1"),
        ),
        "bash" => Some(home.join(".bashrc")),
        "zsh" => Some(home.join(".zshrc")),
        "fish" => Some(
            home.join(".config")
                .join("fish")
                .join("config.fish"),
        ),
        _ => None,
    }
}

fn get_shell_init_line(shell: &str) -> String {
    match shell {
        "fish" => "arc shell-init --shell fish | source".to_string(),
        "powershell" => {
            "arc shell-init --shell powershell | Out-String | Invoke-Expression".to_string()
        }
        s => format!("eval \"$(arc shell-init --shell {})\"", s),
    }
}

fn ensure_shell_profile(shell: &str) {
    let profile_path = match get_shell_profile_path(shell) {
        Some(p) => p,
        None => {
            display::warn(&format!(
                "No profile path is configured for shell: {}",
                shell
            ));
            return;
        }
    };

    if let Some(dir) = profile_path.parent() {
        let _ = fs::create_dir_all(dir);
    }

    let profile_line = get_shell_init_line(shell);
    let marker = if shell == "powershell" {
        "# arc shell integration"
    } else {
        "# arc"
    };
    let block = format!("{}\n{}\n", marker, profile_line);

    let existing = if profile_path.exists() {
        fs::read_to_string(&profile_path).unwrap_or_default()
    } else {
        String::new()
    };

    if existing.contains(&profile_line) {
        display::info(&format!(
            "Shell integration already present in {}",
            profile_path.display()
        ));
        return;
    }

    let needs_spacing = !existing.is_empty() && !existing.ends_with('\n');
    let prefix = if needs_spacing { "\n" } else { "" };
    let content = format!("{}{}{}", existing, prefix, block);

    match fs::write(&profile_path, &content) {
        Ok(_) => display::success(&format!(
            "Added shell integration to {}",
            profile_path.display()
        )),
        Err(e) => display::warn(&format!(
            "Failed to write shell profile {}: {}",
            profile_path.display(),
            e
        )),
    }
}

fn setup_shims() -> Result<()> {
    let user_bin_dir = get_user_bin_dir();
    fs::create_dir_all(&user_bin_dir)?;

    let exe_path = match get_current_exe() {
        Some(p) => p,
        None => {
            display::warn("Could not determine current executable path. Shims may not work correctly.");
            return Ok(());
        }
    };

    let exe_str = exe_path.to_string_lossy();

    // arc.cmd (Windows CMD)
    let cmd_path = user_bin_dir.join("arc.cmd");
    fs::write(&cmd_path, format!("@echo off\r\n\"{}\" %*\r\n", exe_str))?;

    // arc.ps1 (PowerShell)
    let ps1_path = user_bin_dir.join("arc.ps1");
    fs::write(
        &ps1_path,
        format!("& \"{}\" @args\r\n", exe_str.replace('\\', "\\\\")),
    )?;

    // arc (POSIX shell)
    let sh_path = user_bin_dir.join("arc");
    let sh_content = format!(
        "#!/usr/bin/env sh\n\"{}\" \"$@\"\n",
        exe_str.replace('\\', "/")
    );
    fs::write(&sh_path, &sh_content)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o755);
        let _ = fs::set_permissions(&sh_path, perms);
    }

    display::success(&format!(
        "Created local arc shims in {}",
        user_bin_dir.display()
    ));

    // On Windows, update user PATH
    #[cfg(windows)]
    {
        add_to_windows_user_path(&user_bin_dir.to_string_lossy())?;
    }

    Ok(())
}

#[cfg(windows)]
fn add_to_windows_user_path(dir: &str) -> Result<()> {
    let get_path = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-Command",
            "[Environment]::GetEnvironmentVariable('Path','User')",
        ])
        .output()?;

    if !get_path.status.success() {
        display::warn("Failed to read Windows user PATH.");
        return Ok(());
    }

    let current_path = String::from_utf8_lossy(&get_path.stdout).trim().to_string();
    let normalized_dir = dir.replace('/', "\\").to_lowercase();

    let already_in_path = current_path
        .split(';')
        .any(|entry| entry.trim().replace('/', "\\").to_lowercase() == normalized_dir);

    if already_in_path {
        return Ok(());
    }

    let new_path = if current_path.is_empty() {
        dir.to_string()
    } else {
        format!("{};{}", current_path, dir)
    };

    let escaped = new_path.replace('\'', "''");
    let cmd = format!(
        "[Environment]::SetEnvironmentVariable('Path', '{}', 'User')",
        escaped
    );

    let set_path = Command::new("powershell.exe")
        .args(["-NoProfile", "-Command", &cmd])
        .status()?;

    if set_path.success() {
        display::success(&format!("Added {} to Windows user PATH.", dir));
        display::info("Restart your terminal for the PATH change to take effect.");
    } else {
        display::warn("Failed to update Windows user PATH.");
    }

    Ok(())
}

fn print_next_steps(shell: &str) {
    println!();
    section_header("Next Steps");
    println!();
    display::detail("Open a new terminal session so PATH/profile changes are loaded.");
    display::detail("Test the install with: arc --help");
    display::detail(&format!(
        "Load shell integration now with: {}",
        get_shell_init_line(shell)
    ));
    println!();
}

pub fn handle_setup(shell: Option<&str>, no_shell: bool) -> Result<()> {
    let detected = detect_shell();
    let resolved_shell = shell.unwrap_or(detected);

    println!();
    section_header("Setup");
    println!();
    display::info("Installing local arc shims and checking PATH...");
    setup_shims()?;

    if !no_shell {
        display::info(&format!(
            "Installing {} shell integration...",
            resolved_shell
        ));
        ensure_shell_profile(resolved_shell);
    } else {
        display::warn("Skipped shell profile integration (--no-shell).");
    }

    display::success("arc setup complete.");
    print_next_steps(resolved_shell);
    Ok(())
}

/// Returns true when the running binary lives inside ~/.arc-install (bootstrap install).
fn is_bootstrap_install() -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) else {
        return false;
    };
    let bootstrap_root = std::path::Path::new(&home).join(".arc-install");
    exe.starts_with(&bootstrap_root)
}

/// Get the repo root for a bootstrap install (parent of rust/).
fn get_bootstrap_repo_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    // exe is at ~/.arc-install/repo/rust/target/release/arc(.exe)
    // go up: release -> target -> rust -> repo
    let repo = exe.parent()?.parent()?.parent()?.parent()?;
    Some(repo.to_path_buf())
}

pub fn handle_update(shell: Option<&str>, no_shell: bool) -> Result<()> {
    println!();
    section_header("Update");
    println!();

    if is_bootstrap_install() {
        if let Some(repo_root) = get_bootstrap_repo_root() {
            display::info("Bootstrap install detected — pulling latest code...");

            let git_fetch = Command::new("git")
                .args(["fetch", "--all", "--prune"])
                .current_dir(&repo_root)
                .status();
            let git_reset = Command::new("git")
                .args(["reset", "--hard", "origin/master"])
                .current_dir(&repo_root)
                .status();

            if git_fetch.is_err() || git_reset.is_err() {
                display::warn("git pull failed — continuing with shim refresh only.");
            } else {
                display::success("Code updated.");
                display::info("Rebuilding binary...");
                let build = Command::new("cargo")
                    .args(["build", "--release"])
                    .current_dir(repo_root.join("rust"))
                    .status();
                match build {
                    Ok(s) if s.success() => display::success("Binary rebuilt."),
                    _ => display::warn("Rebuild failed — the previous binary is still in use."),
                }
            }
        }
        println!();
    }

    display::info("Refreshing shims and shell integration...");
    handle_setup(shell, no_shell)?;
    Ok(())
}

pub fn handle_uninstall(force: bool) -> Result<()> {
    let user_bin_dir = get_user_bin_dir();

    if !force {
        // Simple confirmation
        print!("This will remove arc shims and shell integration. Continue? (y/N): ");
        let _ = std::io::stdout().flush();

        let stdin = std::io::stdin();
        use std::io::BufRead;
        let mut line = String::new();
        let _ = stdin.lock().read_line(&mut line);
        let answer = line.trim().to_lowercase();
        if answer != "y" && answer != "yes" {
            display::warn("Aborted.");
            return Ok(());
        }
    }

    // Remove shims
    let shims = ["arc", "arc.cmd", "arc.ps1"];
    for shim in &shims {
        let path = user_bin_dir.join(shim);
        if path.exists() {
            let _ = fs::remove_file(&path);
            display::success(&format!("Removed: {}", path.display()));
        }
    }

    // Remove shell integration
    remove_shell_integrations();

    display::success("arc uninstalled.");
    Ok(())
}

fn remove_shell_integrations() {
    let shells = if cfg!(windows) {
        vec!["powershell"]
    } else {
        vec!["bash", "zsh", "fish"]
    };

    for shell in shells {
        if let Some(profile_path) = get_shell_profile_path(shell) {
            if !profile_path.exists() {
                continue;
            }
            let content = match fs::read_to_string(&profile_path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let init_line = get_shell_init_line(shell);
            if content.contains(&init_line) {
                let marker = if shell == "powershell" {
                    "# arc shell integration"
                } else {
                    "# arc"
                };
                let new_content = content
                    .lines()
                    .filter(|line| {
                        !line.contains(&init_line) && *line != marker
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                let new_content = new_content.trim().to_string() + "\n";
                if let Ok(_) = fs::write(&profile_path, &new_content) {
                    display::success(&format!(
                        "Removed shell integration from {}",
                        profile_path.display()
                    ));
                }
            }
        }
    }
}
