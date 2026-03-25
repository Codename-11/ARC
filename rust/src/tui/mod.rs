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
    layout::{Constraint, Direction, Layout as RLayout},
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
pub struct ProfileData {
    pub name: String,
    pub tool: String,
    pub auth_type: String,
    pub authenticated: bool,
    pub is_active: bool,
    pub description: Option<String>,
    pub config_dir: String,
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
    pub pending_launch: Option<String>,
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

    fn sorted_profile_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.profiles.keys().cloned().collect();
        names.sort();
        names
    }

    fn launch_selected_profile(&mut self) {
        let names = self.sorted_profile_names();
        if let Some(name) = names.get(self.selected_profile_idx) {
            let name = name.clone();
            self.should_quit = true;
            self.pending_launch = Some(name);
        }
    }

    fn switch_active_profile(&mut self) {
        let names = self.sorted_profile_names();
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

    pub fn handle_key(&mut self, code: KeyCode, _modifiers: KeyModifiers) {
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

            KeyCode::Up | KeyCode::Char('k') => {
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

            KeyCode::Down | KeyCode::Char('j') => {
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
                    self.launch_selected_profile();
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

fn load_profiles() -> (HashMap<String, ProfileData>, String, u32) {
    let config_path = get_config_path();

    let content = match std::fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(_) => return (HashMap::new(), String::new(), 1),
    };

    let config: ArcConfig = match serde_json::from_str(&content) {
        Ok(c) => c,
        Err(_) => return (HashMap::new(), String::new(), 1),
    };

    let active = config.active_profile.clone();
    let version = config.version;
    let mut profiles = HashMap::new();

    for (name, profile) in &config.profiles {
        let tool = profile.tool.clone().unwrap_or_else(|| "claude".to_string());
        let auth_type = profile.auth_type.to_string();
        let is_active = name == &active;
        let authenticated = check_auth_quick(name, &auth_type, &profile.config_dir);

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
            },
        );
    }

    (profiles, active, version)
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

    let (profiles, active_profile, config_version) = load_profiles();

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
    if let Some(name) = app.pending_launch {
        if let Some(profile) = app.profiles.get(&name) {
            let tool = profile.tool.clone();
            let config_dir = profile.config_dir.clone();

            let status = std::process::Command::new(&tool)
                .env("CLAUDE_CONFIG_DIR", &config_dir)
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
