use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph},
    Frame,
};

use crate::tui::{theme, App, View};

struct NavItem {
    label: &'static str,
    icon: &'static str,
}

fn nav_items() -> Vec<NavItem> {
    vec![
        NavItem { label: "Workspace", icon: "◇" },
        NavItem { label: "Profiles",  icon: "◎" },
        NavItem { label: "Doctor",    icon: "+" },
        NavItem { label: "Settings",  icon: ":" },
    ]
}

fn view_index(view: &View) -> usize {
    match view {
        View::Dashboard => 0,
        View::Profiles  => 1,
        View::Doctor    => 2,
        View::Settings  => 3,
    }
}

/// Render the sidebar with nav items, status section, and queue section.
pub fn render_sidebar(f: &mut Frame, area: Rect, app: &App, focused: bool) {
    let border_color = if focused { theme::BORDER_FOCUS } else { theme::BORDER };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border_color))
        .style(Style::default().bg(theme::BG_PANEL));

    let inner = block.inner(area);
    f.render_widget(block, area);

    if inner.height < 3 || inner.width < 4 {
        return;
    }

    let items = nav_items();
    let nav_count = items.len() as u16;

    // Vertical layout inside the sidebar
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),          // header: title + subtitle + gap
            Constraint::Length(nav_count),  // nav items
            Constraint::Length(2),          // "status" divider
            Constraint::Length(4),          // status content
            Constraint::Length(2),          // "queue" divider
            Constraint::Min(1),             // queue list
        ])
        .split(inner);

    // ── Header ────────────────────────────────────────────────────────────
    {
        let h = chunks[0];
        f.render_widget(
            Paragraph::new(vec![
                Line::from(Span::styled(
                    "ARC shell",
                    Style::default().fg(theme::SECONDARY).add_modifier(Modifier::BOLD),
                )),
                Line::from(Span::styled(
                    "Launch-first workspace",
                    Style::default().fg(theme::TEXT_DIM),
                )),
            ])
            .style(Style::default().bg(theme::BG_PANEL)),
            Rect { x: h.x + 1, y: h.y, width: h.width.saturating_sub(1), height: h.height },
        );
    }

    // ── Nav items ─────────────────────────────────────────────────────────
    {
        let nav_area = chunks[1];
        let current_idx = view_index(&app.selected_view);

        for (i, item) in items.iter().enumerate() {
            let is_active = i == current_idx;
            let is_highlighted = focused && i == app.selected_sidebar_idx;
            let row_y = nav_area.y + i as u16;

            if row_y >= nav_area.y + nav_area.height {
                break;
            }

            let bg = if is_highlighted && !is_active { theme::BG_SELECTED } else { theme::BG_PANEL };
            let text_color = if is_active { theme::PRIMARY } else if is_highlighted { theme::TEXT } else { theme::TEXT_DIM };
            let arrow = if is_active { "▶ " } else { "  " };
            let icon_color = if is_active { theme::SECONDARY } else { theme::TEXT_DIM };

            let row_line = Line::from(vec![
                Span::styled(
                    arrow,
                    Style::default()
                        .fg(if is_active { theme::PRIMARY } else { theme::BORDER })
                        .add_modifier(if is_active { Modifier::BOLD } else { Modifier::empty() }),
                ),
                Span::styled(item.icon, Style::default().fg(icon_color)),
                Span::raw(" "),
                Span::styled(
                    item.label,
                    Style::default()
                        .fg(text_color)
                        .add_modifier(if is_active { Modifier::BOLD } else { Modifier::empty() }),
                ),
            ]);

            f.render_widget(
                Paragraph::new(row_line).style(Style::default().bg(bg)),
                Rect { x: nav_area.x + 1, y: row_y, width: nav_area.width.saturating_sub(1), height: 1 },
            );
        }
    }

    // ── "status" divider ──────────────────────────────────────────────────
    {
        let d = chunks[2];
        f.render_widget(
            Paragraph::new(Line::from(Span::styled("status", Style::default().fg(theme::BORDER))))
                .style(Style::default().bg(theme::BG_PANEL)),
            Rect { x: d.x + 1, y: d.y + 1, width: d.width.saturating_sub(1), height: 1 },
        );
    }

    // ── Status content ────────────────────────────────────────────────────
    {
        let s = chunks[3];
        let active_profile = app.profiles.values().find(|p| p.is_active);
        let ready_count = app.profiles.values().filter(|p| p.authenticated).count();
        let total = app.profiles.len();

        let lines: Vec<Line> = vec![
            Line::from(Span::styled("active profile", Style::default().fg(theme::TEXT_DIM))),
            Line::from(match active_profile {
                Some(p) => Span::styled(p.name.clone(), Style::default().fg(theme::TEXT).add_modifier(Modifier::BOLD)),
                None    => Span::styled("none", Style::default().fg(theme::TEXT_DIM)),
            }),
            Line::from(Span::styled("profiles ready", Style::default().fg(theme::TEXT_DIM))),
            Line::from(Span::styled(
                format!("{}/{}", ready_count, total),
                Style::default().fg(if total > 0 { theme::TEXT } else { theme::TEXT_DIM }),
            )),
        ];

        f.render_widget(
            Paragraph::new(lines).style(Style::default().bg(theme::BG_PANEL)),
            Rect { x: s.x + 1, y: s.y, width: s.width.saturating_sub(1), height: s.height },
        );
    }

    // ── "queue" divider ───────────────────────────────────────────────────
    {
        let d = chunks[4];
        f.render_widget(
            Paragraph::new(Line::from(Span::styled("queue", Style::default().fg(theme::BORDER))))
                .style(Style::default().bg(theme::BG_PANEL)),
            Rect { x: d.x + 1, y: d.y + 1, width: d.width.saturating_sub(1), height: 1 },
        );
    }

    // ── Queue list ────────────────────────────────────────────────────────
    {
        let q = chunks[5];
        let ordered_names = app.ordered_profile_names();
        let profiles_sorted: Vec<_> = ordered_names
            .iter()
            .filter_map(|name| app.profiles.get(name))
            .collect();

        if profiles_sorted.is_empty() {
            f.render_widget(
                Paragraph::new(Line::from(vec![
                    Span::styled("○ ", Style::default().fg(theme::TEXT_DIM)),
                    Span::styled("none", Style::default().fg(theme::TEXT_DIM)),
                ]))
                .style(Style::default().bg(theme::BG_PANEL)),
                Rect { x: q.x + 1, y: q.y, width: q.width.saturating_sub(1), height: 1 },
            );
        } else {
            let list_items: Vec<ListItem> = profiles_sorted
                .iter()
                .take(5)
                .map(|p| {
                    let dot_color = if p.is_active { theme::ACCENT } else { theme::TEXT_DIM };
                    let dot = if p.is_active { "●" } else { "○" };
                    let name_color = if p.is_active { theme::TEXT } else { theme::TEXT_DIM };
                    let status_text = if p.authenticated { "ready" } else { "setup" };
                    let status_color = if p.authenticated { theme::SUCCESS } else { theme::TEXT_DIM };

                    ListItem::new(Line::from(vec![
                        Span::styled(dot, Style::default().fg(dot_color)),
                        Span::raw(" "),
                        Span::styled(
                            p.name.clone(),
                            Style::default()
                                .fg(name_color)
                                .add_modifier(if p.is_active { Modifier::BOLD } else { Modifier::empty() }),
                        ),
                        Span::raw(" "),
                        Span::styled(status_text, Style::default().fg(status_color)),
                    ]))
                })
                .collect();

            f.render_widget(
                List::new(list_items).style(Style::default().bg(theme::BG_PANEL)),
                Rect { x: q.x + 1, y: q.y, width: q.width.saturating_sub(1), height: q.height },
            );
        }
    }
}
