use ratatui::{layout::Rect, Frame};

use crate::tui::{App, components::profile_list::render_profile_list};

/// Render the profiles view — delegates to the ProfileList component.
pub fn render_profiles(f: &mut Frame, area: Rect, app: &App) {
    render_profile_list(f, area, app);
}
