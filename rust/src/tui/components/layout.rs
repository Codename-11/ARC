use ratatui::{
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use crate::tui::{theme, App, View};

/// Render the root background fill.
pub fn render_background(f: &mut Frame, area: Rect) {
    let bg = Block::default()
        .borders(Borders::NONE)
        .style(Style::default().bg(theme::BG));
    f.render_widget(bg, area);
}

/// Render a horizontal separator line using theme border color.
pub fn render_separator(f: &mut Frame, area: Rect) {
    let line = "─".repeat(area.width as usize);
    let p = Paragraph::new(Line::from(Span::styled(line, Style::default().fg(theme::BORDER))))
        .style(Style::default().bg(theme::BG));
    f.render_widget(p, area);
}

/// Render the content pane border + 2-line header (view title + description).
/// Returns the inner Rect below the header, where the view should render its content.
pub fn render_content_frame(f: &mut Frame, area: Rect, app: &App, focused: bool) -> Rect {
    let border_color = if focused { theme::BORDER_FOCUS } else { theme::BORDER };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border_color))
        .style(Style::default().bg(theme::BG_PANEL));

    let inner = block.inner(area);
    f.render_widget(block, area);

    if inner.height < 3 || inner.width < 4 {
        return inner;
    }

    // paddingX=2, paddingY=1
    let padded_inner = Rect {
        x: inner.x + 2,
        y: inner.y + 1,
        width: inner.width.saturating_sub(4),
        height: inner.height.saturating_sub(2),
    };

    if padded_inner.height < 2 {
        return padded_inner;
    }

    let view_label = match app.selected_view {
        View::Dashboard => "Workspace",
        View::Profiles  => "Profiles",
        View::Settings  => "Settings",
        View::Doctor    => "Doctor",
    };

    let focus_label = if focused { "content focus" } else { "nav focus" };
    let separator_count = (padded_inner.width as usize)
        .saturating_sub(view_label.len() + focus_label.len() + 4)
        .min(80);

    // Title line: ViewLabel  ─────────────────────  focus-label
    let title_line = Line::from(vec![
        Span::styled(view_label, Style::default().fg(theme::PRIMARY).add_modifier(Modifier::BOLD)),
        Span::raw("  "),
        Span::styled("─".repeat(separator_count), Style::default().fg(theme::BORDER)),
        Span::raw("  "),
        Span::styled(focus_label, Style::default().fg(theme::TEXT_DIM)),
    ]);
    f.render_widget(
        Paragraph::new(title_line).style(Style::default().bg(theme::BG_PANEL)),
        Rect { x: padded_inner.x, y: padded_inner.y, width: padded_inner.width, height: 1 },
    );

    // Description line
    let desc = match app.selected_view {
        View::Dashboard => "Workspace shell centered on launch flow and profile state.",
        View::Profiles  => "Manage the profile queue and launch targets.",
        View::Doctor    => "Run health checks across configured tools.",
        View::Settings  => "Inspect config and shell behavior.",
    };
    if padded_inner.height > 1 {
        f.render_widget(
            Paragraph::new(Line::from(Span::styled(
                desc,
                Style::default().fg(theme::TEXT_DIM),
            )))
            .style(Style::default().bg(theme::BG_PANEL)),
            Rect {
                x: padded_inner.x,
                y: padded_inner.y + 1,
                width: padded_inner.width,
                height: 1,
            },
        );
    }

    // Return area below the 2-line header for view content
    Rect {
        x: padded_inner.x,
        y: padded_inner.y + 2,
        width: padded_inner.width,
        height: padded_inner.height.saturating_sub(2),
    }
}
