use ratatui::style::Color;

// ── Dark theme colors (matching DARK_THEME in theme.tsx) ──────────────────

/// Main background — slate-900 #0f172a
pub const BG: Color = Color::Rgb(15, 23, 42);

/// Panel background — slate-800 #1e293b
pub const BG_PANEL: Color = Color::Rgb(30, 41, 59);

/// Selected row background — deep blue #1e3a5f
pub const BG_SELECTED: Color = Color::Rgb(30, 58, 95);

/// Border — slate-700 #334155
pub const BORDER: Color = Color::Rgb(51, 65, 85);

/// Focused border — sky-300 #7dd3fc (matches primary)
pub const BORDER_FOCUS: Color = Color::Rgb(125, 211, 252);

/// Primary — sky-300 #7dd3fc
pub const PRIMARY: Color = Color::Rgb(125, 211, 252);

/// Secondary — purple-400 #c084fc
pub const SECONDARY: Color = Color::Rgb(192, 132, 252);

/// Accent / success — green-400 #4ade80
pub const ACCENT: Color = Color::Rgb(74, 222, 128);

/// Success — green-400 #4ade80
pub const SUCCESS: Color = Color::Rgb(74, 222, 128);

/// Warning — amber-400 #fbbf24
pub const WARNING: Color = Color::Rgb(251, 191, 36);

/// Error — red-400 #f87171
pub const ERROR: Color = Color::Rgb(248, 113, 113);

/// Text — slate-200 #e2e8f0
pub const TEXT: Color = Color::Rgb(226, 232, 240);

/// Dimmed text — slate-500 #64748b
pub const TEXT_DIM: Color = Color::Rgb(100, 116, 139);
