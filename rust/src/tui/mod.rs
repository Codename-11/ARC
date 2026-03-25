pub mod theme;
pub mod components;
pub mod views;

use std::collections::HashMap;
use std::io;
use std::time::Duration;

use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout as RLayout, Rect},
    style::Style,
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph},
    Terminal,
};

use crate::paths::get_config_path;
use crate::types::ArcConfig;

// ── View ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum View {
    Dashboard,
    Profiles,
    Doctor,
    Settings,
}

impl View {
    fn next(&self) -> View {
        match self {
            View::Dashboard => View::Profiles,
            View::Profiles  => View::Doctor,
            View::Doctor    => View::Settings,
            View::Settings  => View::Dashboard,
        }
    }

    fn prev(&self) -> View {
        match self {
            View::Dashboard => View::Settings,
            View::Profiles  => View::Dashboard,
            View::Doctor    => View::Profiles,
            View::Settings  => View::Doctor,
        }
    }

    fn from_index(i: usize) -> View {
        match i {
            0 => View::Dashboard,
            1 => View::Profiles,
            2 => View::Doctor,
            3 => View::Settings,
            _ => View::Dashboard,
        }
    }

    fn to_index(&self) -> usize {
        match self {
            View::Dashboard => 0,
            View::Profiles  => 1,
            View::Doctor    => 2,
            View::Settings  => 3,
        }
    }

    #[allow(dead_code)]
    pub fn title(&self) -> &'static str {
        match self {
            View::Dashboard => "Dashboard",
            View::Profiles  => "Profiles",
            View::Doctor    => "Doctor",
            View::Settings  => "Settings",
        }
    }
}

// ── ProfileData ───────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ProfileData {
    pub name: String,
    pub tool: String,
    pub auth_type: String,
    pub authenticated: bool,
    pub is_active: bool,
    pub description: Option<String>,
    pub config_dir: String,
    pub launch_args: Vec<String>,
}

// ── LaunchModal ───────────────────────────────────────────────────────────

pub struct LaunchModal {
    pub profile_name: String,
    pub tool: String,
    pub input: String,
    pub cursor_pos: usize,
}

// ── App ───────────────────────────────────────────────────────────────────

pub struct App {
    pub active_profile: String,
    pub profiles: HashMap<String, ProfileData>,
    pub selected_view: View,
    pub selected_sidebar_idx: usize,
    /// true = sidebar has focus, false = content pane
    pub sidebar_focused: bool,
    pub selected_profile_idx: usize,
    pub should_quit: bool,
    pub config_version: u32,
    pub status_message: Option<String>,
    pub pending_launch: Option<(String, Vec<String>)>,
    pub launch_modal: Option<LaunchModal>,
    /// Ordered list of profile names (drives Profiles view order).
    pub profile_order: Vec<String>,
}

impl App {
    #[allow(dead_code)]
    fn new() -> Self {
        App {
            active_profile: String::new(),
            profiles: HashMap::new(),
            selected_view: View::Dashboard,
            selected_sidebar_idx: 0,
            sidebar_focused: true,
            selected_profile_idx: 0,
            should_quit: false,
            config_version: 1,
            status_message: None,
            pending_launch: None,
            launch_modal: None,
            profile_order: Vec::new(),
        }
    }

    fn nav_count() -> usize {
        4
    }

    fn profile_count(&self) -> usize {
        self.profiles.len()
    }

    fn set_view(&mut self, view: View) {
        self.selected_sidebar_idx = view.to_index();
        self.selected_view = view;
    }

    /// Returns profile names in the order defined by `self.profile_order`.
    /// Profiles not listed in the order are appended alphabetically at the end.
    pub fn ordered_profile_names(&self) -> Vec<String> {
        let mut result: Vec<String> = Vec::new();

        // First: names that appear in profile_order and actually exist
        for name in &self.profile_order {
            if self.profiles.contains_key(name) {
                result.push(name.clone());
            }
        }

        // Then: any profiles not in the order, sorted alphabetically
        let mut extras: Vec<String> = self
            .profiles
            .keys()
            .filter(|k| !self.profile_order.contains(k))
            .cloned()
            .collect();
        extras.sort();
        result.extend(extras);

        result
    }

    fn open_launch_modal(&mut self) {
        let names = self.ordered_profile_names();
        if let Some(name) = names.get(self.selected_profile_idx) {
            if let Some(profile) = self.profiles.get(name) {
                let prefill = profile.launch_args.join(" ");
                let cursor_pos = prefill.len();
                self.launch_modal = Some(LaunchModal {
                    profile_name: name.clone(),
                    tool: profile.tool.clone(),
                    input: prefill,
                    cursor_pos,
                });
            }
        }
    }

    fn switch_active_profile(&mut self) {
        let names = self.ordered_profile_names();
        if let Some(name) = names.get(self.selected_profile_idx).cloned() {
            for (k, p) in self.profiles.iter_mut() {
                p.is_active = k == &name;
            }
            self.active_profile = name.clone();

            // Persist to config.json
            let config_path = get_config_path();
            if let Ok(raw) = std::fs::read_to_string(&config_path) {
                if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&raw) {
                    val["activeProfile"] = serde_json::Value::String(name.clone());
                    if let Ok(json) = serde_json::to_string_pretty(&val) {
                        let _ = std::fs::write(&config_path, json);
                    }
                }
            }

            self.status_message = Some(format!("Switched to {}", name));
        }
    }

    fn save_profile_order(&self) {
        let config_path = get_config_path();
        if let Ok(raw) = std::fs::read_to_string(&config_path) {
            if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&raw) {
                let order_json: Vec<serde_json::Value> = self
                    .profile_order
                    .iter()
                    .map(|s| serde_json::Value::String(s.clone()))
                    .collect();
                val["profileOrder"] = serde_json::Value::Array(order_json);
                if let Ok(json) = serde_json::to_string_pretty(&val) {
                    let _ = std::fs::write(&config_path, json);
                }
            }
        }
    }

    fn handle_modal_key(&mut self, code: KeyCode, _modifiers: KeyModifiers) {
        let modal = match self.launch_modal.as_mut() {
            Some(m) => m,
            None => return,
        };

        match code {
            KeyCode::Esc => {
                self.launch_modal = None;
            }
            KeyCode::Enter => {
                let profile_name = modal.profile_name.clone();
                let extra_args: Vec<String> = modal
                    .input
                    .split_whitespace()
                    .map(|s| s.to_string())
                    .collect();
                self.launch_modal = None;
                self.pending_launch = Some((profile_name, extra_args));
                self.should_quit = true;
            }
            KeyCode::Char(c) => {
                let pos = modal.cursor_pos;
                modal.input.insert(pos, c);
                modal.cursor_pos += 1;
            }
            KeyCode::Backspace => {
                if modal.cursor_pos > 0 {
                    modal.cursor_pos -= 1;
                    let pos = modal.cursor_pos;
                    modal.input.remove(pos);
                }
            }
            KeyCode::Left => {
                if modal.cursor_pos > 0 {
                    modal.cursor_pos -= 1;
                }
            }
            KeyCode::Right => {
                let len = modal.input.len();
                if modal.cursor_pos < len {
                    modal.cursor_pos += 1;
                }
            }
            _ => {}
        }
    }

    pub fn handle_key(&mut self, code: KeyCode, modifiers: KeyModifiers) {
        // If modal is open, route all input there
        if self.launch_modal.is_some() {
            self.handle_modal_key(code, modifiers);
            return;
        }

        match code {
            KeyCode::Char('q') | KeyCode::Esc => {
                self.should_quit = true;
            }

            KeyCode::Tab => {
                self.sidebar_focused = !self.sidebar_focused;
            }

            KeyCode::Char('1') => self.set_view(View::Dashboard),
            KeyCode::Char('2') => self.set_view(View::Profiles),
            KeyCode::Char('3') => self.set_view(View::Doctor),
            KeyCode::Char('4') => self.set_view(View::Settings),

            KeyCode::Up => {
                if modifiers.contains(KeyModifiers::SHIFT)
                    && self.selected_view == View::Profiles
                    && !self.sidebar_focused
                {
                    // Shift+Up: reorder up
                    let idx = self.selected_profile_idx;
                    if idx > 0 {
                        // Ensure profile_order reflects current ordered list
                        self.profile_order = self.ordered_profile_names();
                        self.profile_order.swap(idx, idx - 1);
                        self.selected_profile_idx -= 1;
                        self.save_profile_order();
                        self.status_message = Some("Reordered".to_string());
                    }
                } else if self.sidebar_focused {
                    if self.selected_sidebar_idx > 0 {
                        self.selected_sidebar_idx -= 1;
                        self.selected_view = View::from_index(self.selected_sidebar_idx);
                    }
                } else if self.selected_view == View::Profiles {
                    if self.selected_profile_idx > 0 {
                        self.selected_profile_idx -= 1;
                    }
                }
            }

            KeyCode::Char('k') => {
                if self.sidebar_focused {
                    if self.selected_sidebar_idx > 0 {
                        self.selected_sidebar_idx -= 1;
                        self.selected_view = View::from_index(self.selected_sidebar_idx);
                    }
                } else if self.selected_view == View::Profiles {
                    if self.selected_profile_idx > 0 {
                        self.selected_profile_idx -= 1;
                    }
                }
            }

            KeyCode::Down => {
                if modifiers.contains(KeyModifiers::SHIFT)
                    && self.selected_view == View::Profiles
                    && !self.sidebar_focused
                {
                    // Shift+Down: reorder down
                    let idx = self.selected_profile_idx;
                    let max = self.profile_count().saturating_sub(1);
                    if idx < max {
                        self.profile_order = self.ordered_profile_names();
                        self.profile_order.swap(idx, idx + 1);
                        self.selected_profile_idx += 1;
                        self.save_profile_order();
                        self.status_message = Some("Reordered".to_string());
                    }
                } else if self.sidebar_focused {
                    let max = App::nav_count() - 1;
                    if self.selected_sidebar_idx < max {
                        self.selected_sidebar_idx += 1;
                        self.selected_view = View::from_index(self.selected_sidebar_idx);
                    }
                } else if self.selected_view == View::Profiles {
                    let max = self.profile_count().saturating_sub(1);
                    if self.selected_profile_idx < max {
                        self.selected_profile_idx += 1;
                    }
                }
            }

            KeyCode::Char('j') => {
                if self.sidebar_focused {
                    let max = App::nav_count() - 1;
                    if self.selected_sidebar_idx < max {
                        self.selected_sidebar_idx += 1;
                        self.selected_view = View::from_index(self.selected_sidebar_idx);
                    }
                } else if self.selected_view == View::Profiles {
                    let max = self.profile_count().saturating_sub(1);
                    if self.selected_profile_idx < max {
                        self.selected_profile_idx += 1;
                    }
                }
            }

            KeyCode::Right => {
                let next = self.selected_view.next();
                self.set_view(next);
            }

            KeyCode::Left | KeyCode::BackTab => {
                let prev = self.selected_view.prev();
                self.set_view(prev);
            }

            KeyCode::Enter => {
                if self.selected_view == View::Profiles && !self.sidebar_focused {
                    self.open_launch_modal();
                } else {
                    self.set_view(View::Profiles);
                    self.sidebar_focused = false;
                }
            }

            KeyCode::Char('s') => {
                if self.selected_view == View::Profiles && !self.sidebar_focused {
                    self.switch_active_profile();
                }
            }

            _ => {}
        }
    }
}

// ── Config loading ────────────────────────────────────────────────────────

fn load_profiles() -> (HashMap<String, ProfileData>, String, u32, Vec<String>) {
    let config_path = get_config_path();

    let content = match std::fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(_) => return (HashMap::new(), String::new(), 1, Vec::new()),
    };

    let config: ArcConfig = match serde_json::from_str(&content) {
        Ok(c) => c,
        Err(_) => return (HashMap::new(), String::new(), 1, Vec::new()),
    };

    let active = config.active_profile.clone();
    let version = config.version;
    let profile_order = config.profile_order.clone().unwrap_or_default();
    let mut profiles = HashMap::new();

    for (name, profile) in &config.profiles {
        let tool = profile.tool.clone().unwrap_or_else(|| "claude".to_string());
        let auth_type = profile.auth_type.to_string();
        let is_active = name == &active;
        let authenticated = check_auth_quick(name, &auth_type, &profile.config_dir);
        let launch_args = profile.launch_args.clone().unwrap_or_default();

        profiles.insert(
            name.clone(),
            ProfileData {
                name: name.clone(),
                tool,
                auth_type,
                authenticated,
                is_active,
                description: profile.description.clone(),
                config_dir: profile.config_dir.clone(),
                launch_args,
            },
        );
    }

    (profiles, active, version, profile_order)
}

/// Synchronous auth heuristic (no async needed for display purposes).
fn check_auth_quick(name: &str, auth_type: &str, config_dir: &str) -> bool {
    match auth_type {
        "api-key" => {
            if let Ok(entry) = keyring::Entry::new("arc", &format!("{}-api-key", name)) {
                if entry.get_password().is_ok() {
                    return true;
                }
            }
            std::env::var("ANTHROPIC_API_KEY").is_ok()
        }
        "oauth" => {
            std::path::Path::new(config_dir)
                .join(".credentials.json")
                .exists()
        }
        "bedrock" | "vertex" | "foundry" => true,
        _ => false,
    }
}

// ── Modal rendering ───────────────────────────────────────────────────────

fn render_modal(
    f: &mut ratatui::Frame,
    modal: &LaunchModal,
    screen: Rect,
) {
    // If terminal is too small, show a fallback
    if screen.width < 40 || screen.height < 6 {
        let fallback_area = Rect {
            x: screen.x,
            y: screen.y,
            width: screen.width,
            height: 1,
        };
        f.render_widget(Clear, fallback_area);
        f.render_widget(
            Paragraph::new("terminal too small")
                .style(Style::default().fg(theme::ERROR).bg(theme::BG)),
            fallback_area,
        );
        return;
    }

    // Modal dimensions: ~60 wide, 10 tall, centered
    let modal_w: u16 = 60.min(screen.width.saturating_sub(4));
    let modal_h: u16 = 10.min(screen.height.saturating_sub(2));

    let modal_x = screen.x + (screen.width.saturating_sub(modal_w)) / 2;
    let modal_y = screen.y + (screen.height.saturating_sub(modal_h)) / 2;

    let modal_area = Rect {
        x: modal_x,
        y: modal_y,
        width: modal_w,
        height: modal_h,
    };

    // Clear the area behind the modal
    f.render_widget(Clear, modal_area);

    // Modal border
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::BORDER_FOCUS))
        .style(Style::default().bg(theme::BG_PANEL));

    let inner = block.inner(modal_area);
    f.render_widget(block, modal_area);

    if inner.height < 4 || inner.width < 4 {
        return;
    }

    // Padded inner content area (1 char padding each side)
    let content_x = inner.x + 2;
    let content_w = inner.width.saturating_sub(4);

    // Line 0: "Launch: <profile_name>"
    f.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled("Launch: ", Style::default().fg(theme::TEXT_DIM)),
            Span::styled(
                modal.profile_name.clone(),
                Style::default()
                    .fg(theme::TEXT)
                    .add_modifier(ratatui::style::Modifier::BOLD),
            ),
        ]))
        .style(Style::default().bg(theme::BG_PANEL)),
        Rect { x: content_x, y: inner.y, width: content_w, height: 1 },
    );

    // Line 1: "Tool:   <tool>"
    if inner.height > 1 {
        f.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled("Tool:   ", Style::default().fg(theme::TEXT_DIM)),
                Span::styled(modal.tool.clone(), Style::default().fg(theme::SECONDARY)),
            ]))
            .style(Style::default().bg(theme::BG_PANEL)),
            Rect { x: content_x, y: inner.y + 1, width: content_w, height: 1 },
        );
    }

    // Line 3: "Launch flags:" label
    if inner.height > 3 {
        f.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "Launch flags:",
                Style::default().fg(theme::TEXT_DIM),
            )))
            .style(Style::default().bg(theme::BG_PANEL)),
            Rect { x: content_x, y: inner.y + 3, width: content_w, height: 1 },
        );
    }

    // Line 4: "> <input with cursor>"
    if inner.height > 4 {
        // Build the input display with a block cursor marker
        let before_cursor = &modal.input[..modal.cursor_pos];
        let after_cursor = &modal.input[modal.cursor_pos..];

        let input_line = Line::from(vec![
            Span::styled("> ", Style::default().fg(theme::PRIMARY)),
            Span::styled(before_cursor.to_string(), Style::default().fg(theme::TEXT)),
            // Cursor block: highlight the char at cursor, or a space if at end
            Span::styled(
                "█",
                Style::default().fg(theme::PRIMARY),
            ),
            Span::styled(after_cursor.to_string(), Style::default().fg(theme::TEXT)),
        ]);

        f.render_widget(
            Paragraph::new(input_line).style(Style::default().bg(theme::BG_PANEL)),
            Rect { x: content_x, y: inner.y + 4, width: content_w, height: 1 },
        );
    }

    // Last line: key hints
    let hints_y = inner.y + inner.height.saturating_sub(1);
    if hints_y > inner.y + 4 {
        f.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled("[", Style::default().fg(theme::PRIMARY)),
                Span::styled(
                    "Enter",
                    Style::default()
                        .fg(theme::TEXT)
                        .add_modifier(ratatui::style::Modifier::BOLD),
                ),
                Span::styled("] Launch  ", Style::default().fg(theme::PRIMARY)),
                Span::styled("[", Style::default().fg(theme::PRIMARY)),
                Span::styled(
                    "Esc",
                    Style::default()
                        .fg(theme::TEXT)
                        .add_modifier(ratatui::style::Modifier::BOLD),
                ),
                Span::styled("] Cancel", Style::default().fg(theme::PRIMARY)),
            ]))
            .style(Style::default().bg(theme::BG_PANEL)),
            Rect { x: content_x, y: hints_y, width: content_w, height: 1 },
        );
    }
}

// ── Rendering ─────────────────────────────────────────────────────────────

fn render_frame(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    app: &App,
) -> Result<()> {
    terminal.draw(|f| {
        let size = f.area();

        // Root background fill
        components::layout::render_background(f, size);

        // Compute vertical split: topbar | sep | body | sep | footer
        let vertical = RLayout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(1),
                Constraint::Length(1),
                Constraint::Min(1),
                Constraint::Length(1),
                Constraint::Length(1),
            ])
            .split(size);

        let topbar_area  = vertical[0];
        let sep_top      = vertical[1];
        let body_area    = vertical[2];
        let sep_bot      = vertical[3];
        let footer_area  = vertical[4];

        // Separators
        components::layout::render_separator(f, sep_top);
        components::layout::render_separator(f, sep_bot);

        // Top bar
        components::header::render_header(f, topbar_area, app);

        // Footer
        components::footer::render_footer(f, footer_area, app);

        // Body horizontal split: sidebar | content
        let horizontal = RLayout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Length(24),
                Constraint::Min(1),
            ])
            .split(body_area);

        let sidebar_area  = horizontal[0];
        let content_area  = horizontal[1];

        // Sidebar
        components::sidebar::render_sidebar(f, sidebar_area, app, app.sidebar_focused);

        // Content frame (border + header lines)
        let view_area = components::layout::render_content_frame(
            f,
            content_area,
            app,
            !app.sidebar_focused,
        );

        // View content
        match app.selected_view {
            View::Dashboard => views::dashboard::render_dashboard(f, view_area, app),
            View::Profiles  => views::profiles::render_profiles(f, view_area, app),
            View::Settings  => views::settings::render_settings(f, view_area, app),
            View::Doctor    => views::doctor::render_doctor(f, view_area, app),
        }

        // Modal overlay (rendered last, on top)
        if let Some(ref modal) = app.launch_modal {
            render_modal(f, modal, size);
        }
    })?;
    Ok(())
}

// ── Entry point ───────────────────────────────────────────────────────────

pub fn render_dashboard() -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let (profiles, active_profile, config_version, profile_order) = load_profiles();

    let mut app = App {
        active_profile,
        profiles,
        selected_view: View::Dashboard,
        selected_sidebar_idx: 0,
        sidebar_focused: true,
        selected_profile_idx: 0,
        should_quit: false,
        config_version,
        status_message: None,
        pending_launch: None,
        launch_modal: None,
        profile_order,
    };

    loop {
        render_frame(&mut terminal, &app)?;

        if event::poll(Duration::from_millis(16))? {
            if let Event::Key(key) = event::read()? {
                app.handle_key(key.code, key.modifiers);
            }
        }

        if app.should_quit {
            break;
        }
    }

    // Restore terminal
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    // Post-TUI: handle pending launch
    if let Some((name, extra_args)) = app.pending_launch {
        if let Some(profile) = app.profiles.get(&name) {
            let tool = profile.tool.clone();
            let config_dir = profile.config_dir.clone();

            // Build args: profile's stored launch_args + modal-provided extra args
            let mut args: Vec<String> = profile.launch_args.clone();
            if !extra_args.is_empty() {
                // If extra_args were explicitly provided by the modal, use only those
                args = extra_args;
            }

            let status = std::process::Command::new(&tool)
                .env("CLAUDE_CONFIG_DIR", &config_dir)
                .args(&args)
                .status();

            match status {
                Ok(s) if !s.success() => {
                    eprintln!("arc: {} exited with status {}", tool, s);
                }
                Err(e) => {
                    eprintln!("arc: failed to launch {}: {}", tool, e);
                }
                _ => {}
            }
        }
    }

    Ok(())
}
