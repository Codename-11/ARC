use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct DetectedTool {
    pub tool: String,
    pub config_dir: PathBuf,
    pub display_name: String,
}

struct ToolSignature {
    tool: &'static str,
    dir_name: &'static str,
    display_name: &'static str,
    marker_files: &'static [&'static str],
}

const TOOL_SIGNATURES: &[ToolSignature] = &[
    ToolSignature {
        tool: "claude",
        dir_name: ".claude",
        display_name: "Claude Code",
        marker_files: &[".credentials.json", "settings.json"],
    },
    ToolSignature {
        tool: "gemini",
        dir_name: ".gemini",
        display_name: "Gemini CLI",
        marker_files: &["config.json", "settings.json"],
    },
    ToolSignature {
        tool: "codex",
        dir_name: ".codex",
        display_name: "Codex CLI",
        marker_files: &["config.json", "settings.json"],
    },
];

/// Detect installed agent tool configs on the system.
pub fn detect_tool_configs() -> Vec<DetectedTool> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut detected = Vec::new();

    for sig in TOOL_SIGNATURES {
        let config_dir = home.join(sig.dir_name);

        if !config_dir.exists() {
            continue;
        }

        let has_marker = sig
            .marker_files
            .iter()
            .any(|f| config_dir.join(f).exists());

        if has_marker {
            detected.push(DetectedTool {
                tool: sig.tool.to_string(),
                config_dir,
                display_name: sig.display_name.to_string(),
            });
        }
    }

    detected
}
