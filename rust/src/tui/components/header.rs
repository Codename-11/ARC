use ratatui::{
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use crate::tui::{theme, App, View};

const VERSION: &str = "2.0.0";

/// Render the top bar (single line, bg = BG_PANEL).
/// Left:  ◆ ARC v2.0.0 │ <active-profile · tool> │ N/M ready
/// Right: <view-name> │ ◐ dark
pub fn render_header(f: &mut Frame, area: Rect, app: &App) {
    let bg_style = Style::default().bg(theme::BG_PANEL);

    // Fill the bar with panel background
    let bg_block = Block::default().borders(Borders::NONE).style(bg_style);
    f.render_widget(bg_block, area);

    if area.width < 4 {
        return;
    }

    let active_profile = app.profiles.values().find(|p| p.is_active);
    let ready_count = app.profiles.values().filter(|p| p.authenticated).count();
    let total = app.profiles.len();

    let profile_part = match active_profile {
        Some(p) => format!("{} · {}", p.name, p.tool),
        None => "no active profile".to_string(),
    };
    let ready_part = format!("{}/{} ready", ready_count, total);

    let view_label = match app.selected_view {
        View::Dashboard => "workspace",
        View::Profiles  => "profiles",
        View::Settings  => "settings",
        View::Doctor    => "doctor",
    };

    // Left side
    let left_line = Line::from(vec![
        Span::styled("◆", Style::default().fg(theme::SECONDARY).add_modifier(Modifier::BOLD)),
        Span::raw(" "),
        Span::styled("ARC", Style::default().fg(theme::PRIMARY).add_modifier(Modifier::BOLD)),
        Span::raw(" "),
        Span::styled(format!("v{}", VERSION), Style::default().fg(theme::TEXT_DIM)),
        Span::raw(" "),
        Span::styled("│", Style::default().fg(theme::BORDER)),
        Span::raw(" "),
        Span::styled(profile_part, Style::default().fg(theme::TEXT_DIM)),
        Span::raw(" "),
        Span::styled("│", Style::default().fg(theme::BORDER)),
        Span::raw(" "),
        Span::styled(ready_part, Style::default().fg(theme::TEXT_DIM)),
    ]);

    // Right side
    let right_line = Line::from(vec![
        Span::styled(view_label, Style::default().fg(theme::TEXT_DIM)),
        Span::raw(" "),
        Span::styled("│", Style::default().fg(theme::BORDER)),
        Span::raw(" "),
        Span::styled("◐", Style::default().fg(theme::TEXT_DIM)),
        Span::raw(" "),
        Span::styled("dark", Style::default().fg(theme::TEXT)),
        Span::raw("  │  t toggle"),
    ]);

    // Compute right-side visible length for right-alignment
    // "workspace │ ◐ dark  │  t toggle" ~ 33 chars
    let right_len: u16 = (view_label.len() + 20) as u16;
    let padded_x = area.x + 2;

    let left_area = Rect {
        x: padded_x,
        y: area.y,
        width: area.width.saturating_sub(right_len + 4),
        height: 1,
    };
    f.render_widget(Paragraph::new(left_line).style(bg_style), left_area);

    let right_x = (area.x + area.width).saturating_sub(right_len + 2);
    let right_area = Rect {
        x: right_x,
        y: area.y,
        width: right_len + 2,
        height: 1,
    };
    f.render_widget(Paragraph::new(right_line).style(bg_style), right_area);
}
