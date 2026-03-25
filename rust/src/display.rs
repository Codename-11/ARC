use colored::Colorize;

// ── Message Functions ───────────────────────────────

pub fn success(msg: &str) {
    println!("{} {}", "✔".green(), msg);
}

pub fn error(msg: &str) {
    eprintln!("{} {}", "✖".red(), msg);
}

pub fn warn(msg: &str) {
    eprintln!("{} {}", "⚠".yellow(), msg);
}

pub fn info(msg: &str) {
    println!("{} {}", "ℹ".blue(), msg);
}

pub fn detail(msg: &str) {
    println!("{}", format!("  │ {}", msg).dimmed());
}

/// Section header: ─── Title ────────────────────────
pub fn section_header(title: &str) {
    let width: usize = 48;
    let prefix = "─── ";
    let title_len = title.len();
    let remaining = if width > prefix.len() + title_len + 1 {
        width - prefix.len() - title_len - 1
    } else {
        1
    };
    let line = "─".repeat(remaining);
    println!(
        "{}{} {}",
        prefix.dimmed(),
        title.bold(),
        line.dimmed()
    );
}

/// Single-line banner: ◆ arc v2.0.0 ─ Agent Runtime Control
#[allow(dead_code)]
pub fn get_banner() -> String {
    format!(
        "{} {} {} {}",
        "◆".magenta(),
        "arc".bold().cyan(),
        "v2.0.0".dimmed(),
        "─ Agent Runtime Control".dimmed()
    )
}

/// Large bordered banner for onboarding welcome screen.
pub fn get_large_banner() -> String {
    let line1 = format!("{}  {} {}", "◆".magenta(), "ARC".bold().cyan(), "v2.0.0".dimmed());
    let line2 = format!("   {}", "Agent Runtime Control".dimmed());
    let line3 = format!("   {}", "Unified profile manager for agent CLIs".dimmed());

    let lines = vec![
        strip_ansi_visible(&line1),
        strip_ansi_visible(&line2),
        strip_ansi_visible(&line3),
    ];
    let raw = vec![line1, line2, line3];

    let pad_x: usize = 3;
    let max_len = lines.iter().map(|s| s.len()).max().unwrap_or(0);
    let inner_width = max_len + pad_x * 2;

    let top = format!("╭{}╮", "─".repeat(inner_width)).cyan().to_string();
    let bottom = format!("╰{}╯", "─".repeat(inner_width)).cyan().to_string();
    let empty = format!("│{}│", " ".repeat(inner_width)).cyan().to_string();

    let content: Vec<String> = raw
        .iter()
        .zip(lines.iter())
        .map(|(colored_line, plain)| {
            let right_pad = if inner_width > pad_x + plain.len() {
                inner_width - pad_x - plain.len()
            } else {
                0
            };
            format!(
                "{}{}{}{}{}",
                "│".cyan(),
                " ".repeat(pad_x),
                colored_line,
                " ".repeat(right_pad),
                "│".cyan()
            )
        })
        .collect();

    vec![top, empty.clone()]
        .into_iter()
        .chain(content)
        .chain(vec![empty, bottom])
        .collect::<Vec<_>>()
        .join("\n")
}

/// Redact a secret value — show first 8 and last 4 characters.
pub fn redact(value: &str) -> String {
    if value.len() < 12 {
        return "****".to_string();
    }
    format!("{}...{}", &value[..8], &value[value.len() - 4..])
}

// ── Table Helpers ──────────────────────────────────

pub struct ProfileRow {
    pub name: String,
    pub active: bool,
    pub auth_type: String,
    pub description: Option<String>,
}

pub fn profile_table(profiles: &[ProfileRow]) -> String {
    let headers = ["Name", "Active", "Auth Type", "Description"];
    let rows: Vec<[String; 4]> = profiles
        .iter()
        .map(|p| {
            [
                p.name.clone(),
                if p.active { "*".to_string() } else { String::new() },
                p.auth_type.clone(),
                p.description.clone().unwrap_or_default(),
            ]
        })
        .collect();

    let col_widths: [usize; 4] = std::array::from_fn(|i| {
        let header_len = headers[i].len();
        let max_row = rows.iter().map(|r| r[i].len()).max().unwrap_or(0);
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
                .map(|(i, cell)| format!("{:width$}", cell, width = col_widths[i]))
                .collect::<Vec<_>>()
                .join(sep)
        })
        .collect();

    let mut lines = vec!["  ".to_string() + &header_row, "  ".to_string() + &separator];
    for row in &data_rows {
        lines.push("  ".to_string() + row);
    }
    lines.join("\n")
}

// ── Utilities ──────────────────────────────────────

/// Strip ANSI escape codes to get visible character count.
pub fn strip_ansi_visible(s: &str) -> String {
    let mut result = String::new();
    let mut in_escape = false;
    for ch in s.chars() {
        if in_escape {
            if ch == 'm' {
                in_escape = false;
            }
        } else if ch == '\x1b' {
            in_escape = true;
        } else {
            result.push(ch);
        }
    }
    result
}

pub fn visible_len(s: &str) -> usize {
    strip_ansi_visible(s).len()
}
