use anyhow::Result;
use colored::Colorize;

use crate::auth::get_credential_status;
use crate::config::load_config;
use crate::display::{info, visible_len};

fn format_expiry(expires_at_ms: i64) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let diff = expires_at_ms - now;
    let abs_diff = diff.unsigned_abs() as u64;

    let minutes = abs_diff / 60000;
    let hours = minutes / 60;
    let days = hours / 24;

    let time_str = if days > 0 {
        format!("{}d {}h", days, hours % 24)
    } else if hours > 0 {
        format!("{}h {}m", hours, minutes % 60)
    } else {
        format!("{}m", minutes)
    };

    if diff > 0 {
        format!("expires in {}", time_str)
    } else {
        format!("expired {} ago", time_str)
    }
}

fn format_auth_status(authenticated: bool, expired: Option<bool>) -> String {
    if authenticated {
        "authenticated".green().to_string()
    } else if expired == Some(true) {
        "expired".yellow().to_string()
    } else {
        "not configured".red().to_string()
    }
}

pub fn handle_status() -> Result<()> {
    let config = load_config()?;
    let names: Vec<String> = config.profiles.keys().cloned().collect();

    if names.is_empty() {
        info("No profiles configured. Run \"arc profile create <name>\" to get started.");
        return Ok(());
    }

    let headers = ["Name", "Active", "Tool", "Auth Type", "Status", "Expiry"];
    let mut rows: Vec<[String; 6]> = Vec::new();

    for name in &names {
        let profile = &config.profiles[name];
        let is_active = name == &config.active_profile;

        let (status, expiry) = match get_credential_status(profile) {
            Ok(cred) => {
                let expiry = cred
                    .expires_at
                    .map(|e| format_expiry(e))
                    .unwrap_or_default();
                (format_auth_status(cred.authenticated, cred.expired), expiry)
            }
            Err(_) => ("error".red().to_string(), String::new()),
        };

        rows.push([
            name.clone(),
            if is_active { "*".to_string() } else { String::new() },
            profile.tool.clone().unwrap_or_else(|| "claude".to_string()),
            profile.auth_type.to_string(),
            status,
            expiry,
        ]);
    }

    let col_widths: [usize; 6] = std::array::from_fn(|i| {
        let header_len = headers[i].len();
        let max_row = rows.iter().map(|r| visible_len(&r[i])).max().unwrap_or(0);
        header_len.max(max_row)
    });

    let sep = "  ";
    let header_row: String = headers
        .iter()
        .enumerate()
        .map(|(i, h)| format!("{}", format!("{:width$}", h, width = col_widths[i]).bold()))
        .collect::<Vec<_>>()
        .join(sep);

    let separator: String = col_widths
        .iter()
        .map(|&w| "─".repeat(w))
        .collect::<Vec<_>>()
        .join(sep)
        .dimmed()
        .to_string();

    let data_rows: Vec<String> = rows
        .iter()
        .map(|row| {
            row.iter()
                .enumerate()
                .map(|(i, cell)| {
                    let visible = visible_len(cell);
                    let pad = if col_widths[i] > visible {
                        col_widths[i] - visible
                    } else {
                        0
                    };
                    format!("{}{}", cell, " ".repeat(pad))
                })
                .collect::<Vec<_>>()
                .join(sep)
        })
        .collect();

    let mut lines = vec![
        format!("  {}", header_row),
        format!("  {}", separator),
    ];
    for row in &data_rows {
        lines.push(format!("  {}", row));
    }
    println!("{}", lines.join("\n"));

    Ok(())
}
