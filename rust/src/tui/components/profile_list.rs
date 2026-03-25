use ratatui::{
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use crate::tui::{theme, App};

/// Render the profile list table.
/// Headers: NAME  TOOL  AUTH  STATUS
/// Each row: [cursor] [dot] name  tool  auth  status
pub fn render_profile_list(f: &mut Frame, area: Rect, app: &App) {
    let bg_style = Style::default().bg(theme::BG_PANEL);

    // Fill background
    let bg_block = Block::default().borders(Borders::NONE).style(bg_style);
    f.render_widget(bg_block, area);

    // Use ordered names (respects profile_order)
    let ordered_names = app.ordered_profile_names();

    if ordered_names.is_empty() {
        let empty_lines = vec![
            Line::from(Span::styled("No profiles yet.", Style::default().fg(theme::TEXT_DIM))),
            Line::from(vec![
                Span::styled("Run ", Style::default().fg(theme::TEXT_DIM)),
                Span::styled("arc create <name>", Style::default().fg(theme::PRIMARY).add_modifier(Modifier::BOLD)),
                Span::styled(" to get started.", Style::default().fg(theme::TEXT_DIM)),
            ]),
        ];
        let p = Paragraph::new(empty_lines).style(bg_style);
        f.render_widget(p, Rect { x: area.x + 2, y: area.y + 1, width: area.width.saturating_sub(2), height: area.height });
        return;
    }

    // Collect profile data in display order
    let profiles_ordered: Vec<(&String, &crate::tui::ProfileData)> = ordered_names
        .iter()
        .filter_map(|name| app.profiles.get(name).map(|p| (name, p)))
        .collect();

    // Compute column widths
    let name_w = profiles_ordered.iter().map(|(n, _)| n.len()).max().unwrap_or(4).max(4);
    let tool_w = profiles_ordered.iter().map(|(_, p)| p.tool.len()).max().unwrap_or(4).max(4);
    let auth_w = profiles_ordered.iter().map(|(_, p)| p.auth_type.len()).max().unwrap_or(4).max(4);

    // Header row: NAME  TOOL  AUTH  STATUS
    if area.height < 3 {
        return;
    }

    {
        // "    " (2 for cursor, 2 for dot+space) then columns
        let header_line = Line::from(vec![
            Span::raw("    "), // cursor + dot placeholder
            Span::styled(pad("NAME", name_w + 2), Style::default().fg(theme::TEXT_DIM).add_modifier(Modifier::BOLD)),
            Span::styled(pad("TOOL", tool_w + 2), Style::default().fg(theme::TEXT_DIM).add_modifier(Modifier::BOLD)),
            Span::styled(pad("AUTH", auth_w + 2), Style::default().fg(theme::TEXT_DIM).add_modifier(Modifier::BOLD)),
            Span::styled("STATUS", Style::default().fg(theme::TEXT_DIM).add_modifier(Modifier::BOLD)),
        ]);
        let header_p = Paragraph::new(header_line).style(bg_style);
        f.render_widget(header_p, Rect { x: area.x + 1, y: area.y, width: area.width.saturating_sub(1), height: 1 });

        // Underline
        let separator_len = (4 + name_w + 2 + tool_w + 2 + auth_w + 2 + 8).min(area.width as usize);
        let sep_line = Line::from(Span::styled(
            "─".repeat(separator_len),
            Style::default().fg(theme::BORDER),
        ));
        let sep_p = Paragraph::new(sep_line).style(bg_style);
        f.render_widget(sep_p, Rect { x: area.x + 1, y: area.y + 1, width: area.width.saturating_sub(1), height: 1 });
    }

    // Profile rows
    let rows_start_y = area.y + 2;
    let selected_idx = app.selected_profile_idx;

    for (i, (name, profile)) in profiles_ordered.iter().enumerate() {
        let row_y = rows_start_y + i as u16;
        if row_y >= area.y + area.height {
            break;
        }

        let is_selected = i == selected_idx;
        let is_active = profile.is_active;
        let bg = if is_selected { theme::BG_SELECTED } else { theme::BG_PANEL };

        // Cursor
        let cursor_span = if is_selected {
            Span::styled("❯ ", Style::default().fg(theme::PRIMARY))
        } else {
            Span::raw("  ")
        };

        // Active/inactive dot
        let dot_color = if is_active { theme::ACCENT } else { theme::TEXT_DIM };
        let dot = if is_active { "●" } else { "○" };

        // Name color
        let name_color = if is_selected || is_active { theme::TEXT } else { theme::TEXT_DIM };
        let name_style = Style::default()
            .fg(name_color)
            .add_modifier(if is_active || is_selected { Modifier::BOLD } else { Modifier::empty() });

        // Tool color
        let tool_color = if is_selected { theme::SECONDARY } else { theme::TEXT_DIM };

        // Status
        let (status_icon, status_text, status_color) = if profile.authenticated {
            ("✔ ", "ready", theme::SUCCESS)
        } else {
            ("✖ ", "not set", theme::ERROR)
        };

        let row_line = Line::from(vec![
            cursor_span,
            Span::styled(dot, Style::default().fg(dot_color)),
            Span::raw(" "),
            Span::styled(pad(name, name_w + 2), name_style),
            Span::styled(pad(&profile.tool, tool_w + 2), Style::default().fg(tool_color)),
            Span::styled(pad(&profile.auth_type, auth_w + 2), Style::default().fg(theme::TEXT_DIM)),
            Span::styled(status_icon, Style::default().fg(status_color)),
            Span::styled(status_text, Style::default().fg(status_color)),
        ]);

        let row_p = Paragraph::new(row_line).style(Style::default().bg(bg));
        f.render_widget(row_p, Rect { x: area.x + 1, y: row_y, width: area.width.saturating_sub(1), height: 1 });
    }
}

/// Pad a string to a given width with spaces (truncate if longer).
fn pad(s: &str, width: usize) -> String {
    if s.len() >= width {
        format!("{} ", &s[..width.saturating_sub(1)])
    } else {
        format!("{:width$}", s, width = width)
    }
}
