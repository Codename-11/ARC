use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use crate::tui::{theme, App};
use crate::paths::{get_config_path, get_arc_dir};

/// Render the settings view.
/// Three bordered cards: Configuration, Profiles, Keyboard Shortcuts.
pub fn render_settings(f: &mut Frame, area: Rect, app: &App) {
    if area.height < 4 {
        return;
    }

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(2),  // "Configuration" label
            Constraint::Length(5),  // config card
            Constraint::Length(1),  // gap
            Constraint::Length(2),  // "Profiles" label
            Constraint::Length(4),  // profiles card
            Constraint::Length(1),  // gap
            Constraint::Length(2),  // "Keyboard Shortcuts" label
            Constraint::Length(7),  // shortcuts card
            Constraint::Min(0),
        ])
        .split(area);

    let render_section_label = |f: &mut Frame, a: Rect, label: &str| {
        if a.height == 0 {
            return;
        }
        f.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(label, Style::default().fg(theme::SECONDARY).add_modifier(Modifier::BOLD)),
                Span::raw("  "),
                Span::styled("─".repeat(16), Style::default().fg(theme::BORDER)),
            ]))
            .style(Style::default().bg(theme::BG_PANEL)),
            Rect { x: a.x, y: a.y, width: a.width, height: 1 },
        );
    };

    let render_card = |f: &mut Frame, area: Rect, lines: Vec<Line>| {
        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(theme::BORDER))
            .style(Style::default().bg(theme::BG_PANEL));
        let inner = block.inner(area);
        f.render_widget(block, area);
        f.render_widget(
            Paragraph::new(lines).style(Style::default().bg(theme::BG_PANEL)),
            Rect { x: inner.x + 2, y: inner.y, width: inner.width.saturating_sub(2), height: inner.height },
        );
    };

    let row = |label: &str, value: String| -> Line {
        Line::from(vec![
            Span::styled(format!("{:<20}", label), Style::default().fg(theme::TEXT_DIM)),
            Span::styled(value, Style::default().fg(theme::TEXT)),
        ])
    };

    // ── Configuration ─────────────────────────────────────────────────────
    render_section_label(f, chunks[0], "Configuration");
    {
        let config_path = get_config_path().display().to_string();
        let _arc_dir = get_arc_dir().display().to_string();
        let active = app.profiles.values().find(|p| p.is_active)
            .map(|p| p.name.clone())
            .unwrap_or_else(|| app.active_profile.clone());
        let version = app.config_version.to_string();

        render_card(f, chunks[1], vec![
            row("Config path", config_path),
            row("Schema version", version),
            row("Active profile", active),
        ]);
    }

    // ── Profiles ──────────────────────────────────────────────────────────
    render_section_label(f, chunks[3], "Profiles");
    {
        let total = app.profiles.len().to_string();
        let auth = app.profiles.values().filter(|p| p.authenticated).count().to_string();
        render_card(f, chunks[4], vec![
            row("Total", total),
            row("Authenticated", auth),
        ]);
    }

    // ── Keyboard Shortcuts ────────────────────────────────────────────────
    render_section_label(f, chunks[6], "Keyboard Shortcuts");
    {
        render_card(f, chunks[7], vec![
            row("tab", "Switch focus between sidebar and content".to_string()),
            row("enter", "Launch selected profile from the queue".to_string()),
            row("s", "Switch active profile".to_string()),
            row("d", "Delete selected profile".to_string()),
            row("q", "Quit the dashboard".to_string()),
        ]);
    }
}
