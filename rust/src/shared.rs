use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;

use crate::paths::{
    get_shared_claude_md_path, get_shared_commands_dir, get_shared_memory_dir,
    get_shared_projects_dir, get_shared_settings_path,
};

const MANIFEST_FILE: &str = ".arc-shared.json";
const CLAUDE_MD_START: &str = "<!-- arc:shared:start -->";
const CLAUDE_MD_END: &str = "<!-- arc:shared:end -->";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedManifest {
    pub synced_at: String,
    pub mcp_servers: Vec<String>,
    pub commands: Vec<String>,
    pub claude_md: Option<bool>,
    pub memory_linked: Option<bool>,
    pub projects_linked: Option<bool>,
}

#[derive(Debug, Clone, Default)]
pub struct SyncOptions {
    pub claude_md: Option<bool>,
    pub memory: Option<bool>,
    pub projects: Option<bool>,
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/// Deep merge two JSON objects. `overlay` wins on scalar conflicts.
#[allow(dead_code)]
pub fn deep_merge(base: &Value, overlay: &Value) -> Value {
    match (base, overlay) {
        (Value::Object(b), Value::Object(o)) => {
            let mut result = b.clone();
            for (key, value) in o {
                let merged = match b.get(key) {
                    Some(base_val) => deep_merge(base_val, value),
                    None => value.clone(),
                };
                result.insert(key.clone(), merged);
            }
            Value::Object(result)
        }
        (_, overlay) => overlay.clone(),
    }
}

fn read_json(file_path: &Path) -> Option<Value> {
    let raw = fs::read_to_string(file_path).ok()?;
    let parsed: Value = serde_json::from_str(&raw).ok()?;
    if parsed.is_object() {
        Some(parsed)
    } else {
        None
    }
}

fn write_json(file_path: &Path, data: &Value) -> Result<()> {
    if let Some(dir) = file_path.parent() {
        fs::create_dir_all(dir)?;
    }
    let content = serde_json::to_string_pretty(data)? + "\n";
    fs::write(file_path, content)?;
    Ok(())
}

fn is_junction_or_symlink(dir_path: &Path) -> bool {
    match fs::symlink_metadata(dir_path) {
        Ok(meta) => meta.file_type().is_symlink(),
        Err(_) => false,
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

pub fn get_shared_settings() -> Option<Value> {
    read_json(&get_shared_settings_path())
}

pub fn get_shared_manifest(profile_config_dir: &Path) -> Option<SharedManifest> {
    let manifest_path = profile_config_dir.join(MANIFEST_FILE);
    let raw = fs::read_to_string(&manifest_path).ok()?;
    serde_json::from_str(&raw).ok()
}

// ── CLAUDE.md helpers ────────────────────────────────────────────────────────

fn remove_shared_claude_md_block(content: &str) -> String {
    let start_idx = content.find(CLAUDE_MD_START);
    let end_idx = content.find(CLAUDE_MD_END);

    match (start_idx, end_idx) {
        (Some(start), Some(end)) => {
            let after_end = end + CLAUDE_MD_END.len();
            let tail = content[after_end..].trim_start_matches('\n');
            let before = &content[..start];
            let combined = before.to_string() + tail;
            combined.trim_start().to_string()
        }
        _ => content.to_string(),
    }
}

fn sync_claude_md(profile_config_dir: &Path) -> bool {
    let shared_path = get_shared_claude_md_path();
    if !shared_path.exists() {
        return false;
    }

    let shared_content = match fs::read_to_string(&shared_path) {
        Ok(c) => c.trim().to_string(),
        Err(_) => return false,
    };

    if shared_content.is_empty() {
        return false;
    }

    let profile_claude_md_path = profile_config_dir.join("CLAUDE.md");
    let existing_content = if profile_claude_md_path.exists() {
        fs::read_to_string(&profile_claude_md_path).unwrap_or_default()
    } else {
        String::new()
    };

    let stripped = remove_shared_claude_md_block(&existing_content);
    let injected = if stripped.is_empty() {
        format!(
            "{}\n{}\n{}\n",
            CLAUDE_MD_START, shared_content, CLAUDE_MD_END
        )
    } else {
        format!(
            "{}\n{}\n{}\n\n{}",
            CLAUDE_MD_START, shared_content, CLAUDE_MD_END, stripped
        )
    };

    if let Err(_) = fs::create_dir_all(profile_config_dir) {
        return false;
    }
    fs::write(&profile_claude_md_path, &injected).is_ok()
}

fn unsync_claude_md(profile_config_dir: &Path) {
    let profile_claude_md_path = profile_config_dir.join("CLAUDE.md");
    if !profile_claude_md_path.exists() {
        return;
    }

    let content = match fs::read_to_string(&profile_claude_md_path) {
        Ok(c) => c,
        Err(_) => return,
    };

    let cleaned = remove_shared_claude_md_block(&content);

    if cleaned != content {
        if cleaned.trim().is_empty() {
            let _ = fs::remove_file(&profile_claude_md_path);
        } else {
            let _ = fs::write(&profile_claude_md_path, &cleaned);
        }
    }
}

// ── Junction / symlink helpers ────────────────────────────────────────────────

fn create_link(target_dir: &Path, link_path: &Path) -> Result<()> {
    fs::create_dir_all(target_dir)?;

    if link_path.exists() || is_junction_or_symlink(link_path) {
        if is_junction_or_symlink(link_path) {
            // Already a link — remove and re-create
            fs::remove_dir_all(link_path).ok();
        } else {
            // Plain directory — merge files into shared target first
            if let Ok(entries) = fs::read_dir(link_path) {
                for entry in entries.flatten() {
                    let src = entry.path();
                    let dest = target_dir.join(entry.file_name());
                    if !dest.exists() {
                        let _ = fs::copy(&src, &dest);
                    }
                }
            }
            fs::remove_dir_all(link_path).ok();
        }
    }

    create_symlink_dir(target_dir, link_path)
}

fn remove_link(target_dir: &Path, link_path: &Path) -> Result<()> {
    if !is_junction_or_symlink(link_path) {
        return Ok(());
    }

    fs::remove_dir_all(link_path).ok();
    fs::create_dir_all(link_path)?;

    if target_dir.exists() {
        if let Ok(entries) = fs::read_dir(target_dir) {
            for entry in entries.flatten() {
                let src = entry.path();
                let dest = link_path.join(entry.file_name());
                if !dest.exists() {
                    let _ = fs::copy(&src, &dest);
                }
            }
        }
    }

    Ok(())
}

#[cfg(windows)]
fn create_symlink_dir(target: &Path, link: &Path) -> Result<()> {
    // Use mklink /J for directory junctions (does not require elevated privileges)
    let status = std::process::Command::new("cmd")
        .args([
            "/c",
            "mklink",
            "/J",
            &link.to_string_lossy(),
            &target.to_string_lossy(),
        ])
        .status()
        .context("Failed to run mklink /J")?;

    if !status.success() {
        anyhow::bail!(
            "mklink /J failed for {} -> {}",
            link.display(),
            target.display()
        );
    }
    Ok(())
}

#[cfg(unix)]
fn create_symlink_dir(target: &Path, link: &Path) -> Result<()> {
    use std::os::unix::fs::symlink;
    symlink(target, link).with_context(|| {
        format!(
            "Failed to create symlink {} -> {}",
            link.display(),
            target.display()
        )
    })
}

// ── Core sync / unsync ────────────────────────────────────────────────────────

pub fn sync_shared_to_profile(profile_config_dir: &Path, opts: SyncOptions) -> Result<()> {
    let shared_settings = get_shared_settings();
    let shared_commands_dir = get_shared_commands_dir();
    let existing_manifest = get_shared_manifest(profile_config_dir);

    let prev_mcp_keys: std::collections::HashSet<String> = existing_manifest
        .as_ref()
        .map(|m| m.mcp_servers.iter().cloned().collect())
        .unwrap_or_default();
    let prev_commands: std::collections::HashSet<String> = existing_manifest
        .as_ref()
        .map(|m| m.commands.iter().cloned().collect())
        .unwrap_or_default();

    // Resolve opt flags
    let sync_claude_md_flag = opts.claude_md.unwrap_or_else(|| {
        existing_manifest
            .as_ref()
            .and_then(|m| m.claude_md)
            .unwrap_or(false)
    });
    let sync_memory_flag = opts.memory.unwrap_or_else(|| {
        existing_manifest
            .as_ref()
            .and_then(|m| m.memory_linked)
            .unwrap_or(false)
    });
    let sync_projects_flag = opts.projects.unwrap_or_else(|| {
        existing_manifest
            .as_ref()
            .and_then(|m| m.projects_linked)
            .unwrap_or(false)
    });

    let mut synced_mcp_keys: Vec<String> = Vec::new();
    let mut synced_commands: Vec<String> = Vec::new();

    // ── settings.json / mcpServers ──────────────────────────────────────────
    let settings_path = profile_config_dir.join("settings.json");
    let profile_settings: Value = read_json(&settings_path).unwrap_or(Value::Object(Default::default()));

    let mut mcp_servers = profile_settings
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    if let Some(ref ss) = shared_settings {
        // Remove previously-synced keys
        for key in &prev_mcp_keys {
            mcp_servers.remove(key);
        }

        if let Some(shared_mcp) = ss.get("mcpServers").and_then(|v| v.as_object()) {
            for (key, value) in shared_mcp {
                if !mcp_servers.contains_key(key) {
                    mcp_servers.insert(key.clone(), value.clone());
                }
                synced_mcp_keys.push(key.clone());
            }
        }

        // Merge remaining top-level shared keys (profile wins on conflict)
        let mut merged = ss.clone();
        if let Value::Object(ref mut m) = merged {
            if let Value::Object(ref ps) = profile_settings {
                for (k, v) in ps {
                    m.insert(k.clone(), v.clone());
                }
            }
            m.insert("mcpServers".to_string(), Value::Object(mcp_servers));
        }

        fs::create_dir_all(profile_config_dir)?;
        write_json(&settings_path, &merged)?;
    } else if !prev_mcp_keys.is_empty() {
        // Shared settings removed — clean up previously-synced MCP keys
        let mut updated = profile_settings.clone();
        if let Value::Object(ref mut obj) = updated {
            if let Some(Value::Object(ref mut servers)) = obj.get_mut("mcpServers") {
                for key in &prev_mcp_keys {
                    servers.remove(key);
                }
            }
        }
        write_json(&settings_path, &updated)?;
    }

    // ── commands/ ──────────────────────────────────────────────────────────
    if shared_commands_dir.exists() {
        let profile_commands_dir = profile_config_dir.join("commands");
        fs::create_dir_all(&profile_commands_dir)?;

        let shared_files: std::collections::HashSet<String> = fs::read_dir(&shared_commands_dir)?
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();

        // Remove previously-synced commands that are no longer in shared
        for file in &prev_commands {
            if !shared_files.contains(file) {
                let dest = profile_commands_dir.join(file);
                if dest.exists() {
                    let _ = fs::remove_file(&dest);
                }
            }
        }

        for file in &shared_files {
            let dest = profile_commands_dir.join(file);
            if !dest.exists() || prev_commands.contains(file) {
                let src = shared_commands_dir.join(file);
                fs::copy(&src, &dest)?;
                synced_commands.push(file.clone());
            }
        }
    } else if !prev_commands.is_empty() {
        // shared/commands/ removed — clean up
        let profile_commands_dir = profile_config_dir.join("commands");
        for file in &prev_commands {
            let dest = profile_commands_dir.join(file);
            if dest.exists() {
                let _ = fs::remove_file(&dest);
            }
        }
    }

    // ── CLAUDE.md ──────────────────────────────────────────────────────────
    let claude_md_synced = if sync_claude_md_flag {
        sync_claude_md(profile_config_dir)
    } else if existing_manifest.as_ref().and_then(|m| m.claude_md).unwrap_or(false) {
        unsync_claude_md(profile_config_dir);
        false
    } else {
        false
    };

    // ── memory/ ────────────────────────────────────────────────────────────
    let memory_link_path = profile_config_dir.join("memory");
    if sync_memory_flag {
        create_link(&get_shared_memory_dir(), &memory_link_path)?;
    } else if existing_manifest
        .as_ref()
        .and_then(|m| m.memory_linked)
        .unwrap_or(false)
    {
        remove_link(&get_shared_memory_dir(), &memory_link_path)?;
    }

    // ── projects/ ──────────────────────────────────────────────────────────
    let projects_link_path = profile_config_dir.join("projects");
    if sync_projects_flag {
        create_link(&get_shared_projects_dir(), &projects_link_path)?;
    } else if existing_manifest
        .as_ref()
        .and_then(|m| m.projects_linked)
        .unwrap_or(false)
    {
        remove_link(&get_shared_projects_dir(), &projects_link_path)?;
    }

    // Write manifest
    let manifest = SharedManifest {
        synced_at: chrono_now_iso(),
        mcp_servers: synced_mcp_keys,
        commands: synced_commands,
        claude_md: Some(claude_md_synced),
        memory_linked: Some(sync_memory_flag),
        projects_linked: Some(sync_projects_flag),
    };
    let manifest_path = profile_config_dir.join(MANIFEST_FILE);
    let manifest_json = serde_json::to_value(&manifest)?;
    write_json(&manifest_path, &manifest_json)?;

    Ok(())
}

pub fn unsync_shared_from_profile(profile_config_dir: &Path) -> Result<()> {
    let manifest = match get_shared_manifest(profile_config_dir) {
        Some(m) => m,
        None => return Ok(()),
    };

    // Remove shared MCP keys from settings.json
    let settings_path = profile_config_dir.join("settings.json");
    if let Some(mut profile_settings) = read_json(&settings_path) {
        if let Value::Object(ref mut obj) = profile_settings {
            if let Some(servers) = obj.get_mut("mcpServers") {
                if let Value::Object(ref mut servers_obj) = servers {
                    for key in &manifest.mcp_servers {
                        servers_obj.remove(key);
                    }
                }
            }
        }
        write_json(&settings_path, &profile_settings)?;
    }

    // Remove synced command files
    let profile_commands_dir = profile_config_dir.join("commands");
    for file in &manifest.commands {
        let dest = profile_commands_dir.join(file);
        if dest.exists() {
            let _ = fs::remove_file(&dest);
        }
    }

    // Remove shared CLAUDE.md block
    if manifest.claude_md.unwrap_or(false) {
        unsync_claude_md(profile_config_dir);
    }

    // Restore memory/ from junction/symlink to plain dir
    if manifest.memory_linked.unwrap_or(false) {
        remove_link(&get_shared_memory_dir(), &profile_config_dir.join("memory"))?;
    }

    // Restore projects/ from junction/symlink to plain dir
    if manifest.projects_linked.unwrap_or(false) {
        remove_link(
            &get_shared_projects_dir(),
            &profile_config_dir.join("projects"),
        )?;
    }

    let manifest_path = profile_config_dir.join(MANIFEST_FILE);
    if manifest_path.exists() {
        let _ = fs::remove_file(&manifest_path);
    }

    Ok(())
}

pub fn chrono_now_iso_pub() -> String {
    chrono_now_iso()
}

fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Format as ISO 8601: YYYY-MM-DDTHH:MM:SS.000Z
    let s = secs;
    let sec = s % 60;
    let min = (s / 60) % 60;
    let hour = (s / 3600) % 24;
    let days = s / 86400;
    // Days since epoch to date (approximate, good enough for a timestamp string)
    let (year, month, day) = days_to_ymd(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z",
        year, month, day, hour, min, sec
    )
}

fn days_to_ymd(days: u64) -> (u64, u64, u64) {
    // Simplified Gregorian calendar calculation from Unix epoch (1970-01-01)
    let mut remaining = days;
    let mut year: u64 = 1970;
    loop {
        let days_in_year = if is_leap(year) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        year += 1;
    }
    let leap = is_leap(year);
    let days_in_months: [u64; 12] = [
        31,
        if leap { 29 } else { 28 },
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ];
    let mut month: u64 = 1;
    for &dim in &days_in_months {
        if remaining < dim {
            break;
        }
        remaining -= dim;
        month += 1;
    }
    (year, month, remaining + 1)
}

fn is_leap(y: u64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}
