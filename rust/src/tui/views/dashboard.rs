use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use crate::tui::{theme, App};

/// Render the dashboard/workspace view.
/// Two bordered cards: Active Profile + Overview stats.
pub fn render_dashboard(f: &mut Frame, area: Rect, app: &App) {
    if area.height < 4 {
        return;
    }

    // Minimal height guard before layout
    let card1_h: u16 = 5;
    let card2_h: u16 = 4;
    let section_label_h: u16 = 2;

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(section_label_h),
            Constraint::Length(card1_h),
            Constraint::Length(1),
            Constraint::Length(section_label_h),
            Constraint::Length(card2_h),
            Constraint::Min(0),
        ])
        .split(area);

    // ── Section label ─────────────────────────────────────────────────────
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

    // ── Active Profile section label ──────────────────────────────────────
    render_section_label(f, chunks[0], "Active Profile");

    // ── Active Profile card ───────────────────────────────────────────────
    {
        let card_area = chunks[1];
        let active_profile = app.profiles.values().find(|p| p.is_active);

        let card_block = Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(theme::BORDER))
            .style(Style::default().bg(theme::BG_PANEL));
        let card_inner = card_block.inner(card_area);
        f.render_widget(card_block, card_area);

        if let Some(p) = active_profile {
            let first_line = Line::from(vec![
                Span::styled("● ", Style::default().fg(theme::ACCENT).add_modifier(Modifier::BOLD)),
                Span::styled(p.name.clone(), Style::default().fg(theme::TEXT).add_modifier(Modifier::BOLD)),
                Span::raw(" "),
                Span::styled("│", Style::default().fg(theme::BORDER)),
                Span::raw(" "),
                Span::styled(p.tool.clone(), Style::default().fg(theme::TEXT_DIM)),
                Span::raw(" "),
                Span::styled("│", Style::default().fg(theme::BORDER)),
                Span::raw(" "),
                Span::styled(p.auth_type.clone(), Style::default().fg(theme::TEXT_DIM)),
            ]);

            let second_line = if p.authenticated {
                Line::from(vec![
                    Span::raw("   "),
                    Span::styled("✔ ", Style::default().fg(theme::ACCENT)),
                    Span::styled("Authenticated", Style::default().fg(theme::ACCENT)),
                ])
            } else {
                Line::from(vec![
                    Span::raw("   "),
                    Span::styled("○ ", Style::default().fg(theme::WARNING)),
                    Span::styled("Not authenticated", Style::default().fg(theme::WARNING)),
                ])
            };

            f.render_widget(
                Paragraph::new(vec![first_line, second_line])
                    .style(Style::default().bg(theme::BG_PANEL)),
                Rect {
                    x: card_inner.x + 2,
                    y: card_inner.y,
                    width: card_inner.width.saturating_sub(2),
                    height: card_inner.height,
                },
            );
        } else {
            f.render_widget(
                Paragraph::new(Line::from(Span::styled(
                    "No active profile set.",
                    Style::default().fg(theme::TEXT_DIM),
                )))
                .style(Style::default().bg(theme::BG_PANEL)),
                Rect {
                    x: card_inner.x + 1,
                    y: card_inner.y,
                    width: card_inner.width.saturating_sub(1),
                    height: card_inner.height,
                },
            );
        }
    }

    // ── Overview section label ────────────────────────────────────────────
    render_section_label(f, chunks[3], "Overview");

    // ── Stats card ────────────────────────────────────────────────────────
    {
        let card_area = chunks[4];
        let total = app.profiles.len();
        let auth_count = app.profiles.values().filter(|p| p.authenticated).count();
        let all_auth = total > 0 && auth_count == total;

        let card_block = Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(theme::BORDER))
            .style(Style::default().bg(theme::BG_PANEL));
        let card_inner = card_block.inner(card_area);
        f.render_widget(card_block, card_area);

        let profiles_color = if total > 0 { theme::PRIMARY } else { theme::TEXT_DIM };
        let auth_color = if all_auth { theme::ACCENT } else { theme::WARNING };

        f.render_widget(
            Paragraph::new(vec![
                Line::from(vec![
                    Span::styled("Profiles       ", Style::default().fg(theme::TEXT_DIM)),
                    Span::styled(total.to_string(), Style::default().fg(profiles_color).add_modifier(Modifier::BOLD)),
                ]),
                Line::from(vec![
                    Span::styled("Authenticated  ", Style::default().fg(theme::TEXT_DIM)),
                    Span::styled(
                        format!("{} / {}", auth_count, total),
                        Style::default().fg(auth_color).add_modifier(Modifier::BOLD),
                    ),
                ]),
            ])
            .style(Style::default().bg(theme::BG_PANEL)),
            Rect {
                x: card_inner.x + 2,
                y: card_inner.y,
                width: card_inner.width.saturating_sub(2),
                height: card_inner.height,
            },
        );
    }
}
