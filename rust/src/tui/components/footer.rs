use ratatui::{
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use crate::tui::{theme, App, View};

/// Render the footer bar (single line).
/// Left:  [↑↓] navigate  [Tab] switch view  [Enter] launch  [s] switch  [d] delete  [c] create
/// Right: [ctrl+p] palette  [q] quit
pub fn render_footer(f: &mut Frame, area: Rect, app: &App) {
    let bg_style = Style::default().bg(theme::BG_PANEL);

    let bg_block = Block::default().borders(Borders::NONE).style(bg_style);
    f.render_widget(bg_block, area);

    if area.width < 4 {
        return;
    }

    // Helper: build a [key] desc span group (returns Vec<Span>)
    fn key_hint(key: &'static str, desc: &'static str) -> Vec<Span<'static>> {
        vec![
            Span::styled("[", Style::default().fg(theme::PRIMARY).add_modifier(Modifier::BOLD)),
            Span::styled(key, Style::default().fg(theme::TEXT).add_modifier(Modifier::BOLD)),
            Span::styled("]", Style::default().fg(theme::PRIMARY).add_modifier(Modifier::BOLD)),
            Span::styled(
                concat_str(" ", desc, "  "),
                Style::default().fg(theme::TEXT_DIM),
            ),
        ]
    }

    let mut left_spans: Vec<Span> = Vec::new();
    left_spans.extend(key_hint("↑↓", "navigate"));
    left_spans.extend(key_hint("Tab", "switch view"));
    left_spans.extend(key_hint("Enter", "launch"));

    if app.selected_view == View::Profiles {
        left_spans.extend(key_hint("s", "switch"));
        left_spans.extend(key_hint("d", "delete"));
        left_spans.extend(key_hint("⇧↑↓", "reorder"));
    }

    left_spans.extend(key_hint("c", "create"));

    // Add status message if present
    if let Some(ref msg) = app.status_message {
        left_spans.push(Span::styled(
            format!("  {}", msg),
            Style::default().fg(theme::WARNING),
        ));
    }

    let right_spans: Vec<Span> = vec![
        Span::styled("[", Style::default().fg(theme::PRIMARY).add_modifier(Modifier::BOLD)),
        Span::styled("ctrl+p", Style::default().fg(theme::TEXT).add_modifier(Modifier::BOLD)),
        Span::styled("]", Style::default().fg(theme::PRIMARY).add_modifier(Modifier::BOLD)),
        Span::styled(" palette  ", Style::default().fg(theme::TEXT_DIM)),
        Span::styled("[", Style::default().fg(theme::PRIMARY).add_modifier(Modifier::BOLD)),
        Span::styled("q", Style::default().fg(theme::TEXT).add_modifier(Modifier::BOLD)),
        Span::styled("]", Style::default().fg(theme::PRIMARY).add_modifier(Modifier::BOLD)),
        Span::styled(" quit", Style::default().fg(theme::TEXT_DIM)),
    ];

    let padded_x = area.x + 2;
    let padded_width = area.width.saturating_sub(4);

    let left_area = Rect {
        x: padded_x,
        y: area.y,
        width: padded_width * 2 / 3,
        height: 1,
    };
    f.render_widget(
        Paragraph::new(Line::from(left_spans)).style(bg_style),
        left_area,
    );

    // Right side: ~28 chars
    let right_len: u16 = 28;
    let right_x = (area.x + area.width).saturating_sub(right_len + 2);
    let right_area = Rect {
        x: right_x,
        y: area.y,
        width: right_len + 2,
        height: 1,
    };
    f.render_widget(
        Paragraph::new(Line::from(right_spans)).style(bg_style),
        right_area,
    );
}

// Helper to concatenate &str values without allocation at compile time isn't possible,
// so we use a regular runtime function.
fn concat_str(a: &str, b: &str, c: &str) -> String {
    format!("{}{}{}", a, b, c)
}
