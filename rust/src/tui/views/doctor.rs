use ratatui::{
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use crate::tui::{theme, App};

/// Synchronous check whether a binary exists on PATH.
fn binary_exists(name: &str) -> bool {
    which::which(name).is_ok()
}

/// Render the doctor view.
/// Summary line + per-profile bordered health cards.
pub fn render_doctor(f: &mut Frame, area: Rect, app: &App) {
    if area.height < 2 {
        return;
    }

    let mut profiles_sorted: Vec<_> = app.profiles.iter().collect();
    profiles_sorted.sort_by(|(a, _), (b, _)| a.cmp(b));

    // Compute health for each profile
    let checks: Vec<(String, String, bool, bool, bool)> = profiles_sorted
        .iter()
        .map(|(name, p)| {
            let bin_ok = binary_exists(&p.tool);
            let dir_ok = std::path::Path::new(&p.config_dir).is_dir();
            let auth_ok = p.authenticated;
            (name.to_string(), p.tool.clone(), bin_ok, dir_ok, auth_ok)
        })
        .collect();

    let pass_count = checks.iter().filter(|(_, _, bin, dir, auth)| *bin && *dir && *auth).count();
    let total = checks.len();

    let mut current_y = area.y;

    // ── Summary bar ────────────────────────────────────────────────────────
    if checks.is_empty() {
        f.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "No profiles configured.",
                Style::default().fg(theme::TEXT_DIM),
            )))
            .style(Style::default().bg(theme::BG_PANEL)),
            Rect { x: area.x, y: current_y, width: area.width, height: 1 },
        );
        return;
    }

    let (summary_icon, summary_color) = if pass_count == total {
        ("✔", theme::ACCENT)
    } else {
        ("⚠", theme::WARNING)
    };

    if current_y < area.y + area.height {
        f.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(summary_icon, Style::default().fg(summary_color)),
                Span::raw("  "),
                Span::styled(
                    format!("{}/{} profiles healthy", pass_count, total),
                    Style::default().fg(theme::TEXT),
                ),
            ]))
            .style(Style::default().bg(theme::BG_PANEL)),
            Rect { x: area.x, y: current_y, width: area.width, height: 1 },
        );
        current_y += 2; // summary + gap
    }

    // ── Per-profile cards ─────────────────────────────────────────────────
    for (name, tool, bin_ok, dir_ok, auth_ok) in &checks {
        let card_h: u16 = 6; // border(2) + header(1) + gap(1) + checks(2)
        if current_y + card_h > area.y + area.height {
            break;
        }

        let card_area = Rect { x: area.x, y: current_y, width: area.width, height: card_h };

        let card_block = Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(theme::BORDER))
            .style(Style::default().bg(theme::BG_PANEL));
        let card_inner = card_block.inner(card_area);
        f.render_widget(card_block, card_area);

        // Profile name header
        let header_line = Line::from(vec![
            Span::styled(name.clone(), Style::default().fg(theme::PRIMARY).add_modifier(Modifier::BOLD)),
            Span::raw(" "),
            Span::styled("│", Style::default().fg(theme::BORDER)),
            Span::raw(" "),
            Span::styled(tool.clone(), Style::default().fg(theme::TEXT_DIM)),
        ]);

        let (bin_icon, bin_label, bin_color) = if *bin_ok {
            ("✔", format!("{} binary found", tool), theme::SUCCESS)
        } else {
            ("✖", format!("{} binary not found", tool), theme::ERROR)
        };

        let (dir_icon, dir_label, dir_color) = if *dir_ok {
            ("✔", "config dir exists".to_string(), theme::SUCCESS)
        } else {
            ("✖", "config dir missing".to_string(), theme::ERROR)
        };

        let (auth_icon, auth_label, auth_color) = if *auth_ok {
            ("✔", "authenticated".to_string(), theme::SUCCESS)
        } else {
            ("✖", "not authenticated".to_string(), theme::ERROR)
        };

        let content_x = card_inner.x + 2;
        let content_w = card_inner.width.saturating_sub(2);

        f.render_widget(
            Paragraph::new(header_line).style(Style::default().bg(theme::BG_PANEL)),
            Rect { x: content_x, y: card_inner.y, width: content_w, height: 1 },
        );

        if card_inner.height > 2 {
            f.render_widget(
                Paragraph::new(vec![
                    Line::from(vec![
                        Span::styled(bin_icon, Style::default().fg(bin_color)),
                        Span::raw("  "),
                        Span::styled(bin_label, Style::default().fg(if *bin_ok { theme::TEXT } else { bin_color })),
                    ]),
                    Line::from(vec![
                        Span::styled(dir_icon, Style::default().fg(dir_color)),
                        Span::raw("  "),
                        Span::styled(dir_label, Style::default().fg(if *dir_ok { theme::TEXT } else { dir_color })),
                    ]),
                    Line::from(vec![
                        Span::styled(auth_icon, Style::default().fg(auth_color)),
                        Span::raw("  "),
                        Span::styled(auth_label, Style::default().fg(if *auth_ok { theme::TEXT } else { auth_color })),
                    ]),
                ])
                .style(Style::default().bg(theme::BG_PANEL)),
                Rect { x: content_x, y: card_inner.y + 2, width: content_w, height: card_inner.height.saturating_sub(2) },
            );
        }

        current_y += card_h + 1;
    }
}
