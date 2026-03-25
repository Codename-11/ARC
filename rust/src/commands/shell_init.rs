use anyhow::Result;

#[derive(Debug, Clone, PartialEq)]
pub enum ShellType {
    Bash,
    Zsh,
    Fish,
    Powershell,
}

pub fn detect_shell() -> ShellType {
    if let Ok(shell_env) = std::env::var("SHELL") {
        let base = std::path::Path::new(&shell_env)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        if base == "zsh" {
            return ShellType::Zsh;
        }
        if base == "fish" {
            return ShellType::Fish;
        }
        if base == "bash" {
            return ShellType::Bash;
        }
    }
    if cfg!(windows) {
        return ShellType::Powershell;
    }
    ShellType::Bash
}

fn parse_shell_type(s: &str) -> Option<ShellType> {
    match s {
        "bash" => Some(ShellType::Bash),
        "zsh" => Some(ShellType::Zsh),
        "fish" => Some(ShellType::Fish),
        "powershell" => Some(ShellType::Powershell),
        _ => None,
    }
}

fn generate_bash() -> &'static str {
    r#"# Add to your shell profile: eval "$(arc shell-init)"
# arc shell integration (bash/zsh)

claude() {
  local config_dir
  config_dir=$(arc _resolve-config-dir 2>/dev/null)
  if [ -n "$config_dir" ]; then
    CLAUDE_CONFIG_DIR="$config_dir" command claude "$@"
  else
    command claude "$@"
  fi
}

export ARC_PROFILE="${ARC_PROFILE:-}"
"#
}

fn generate_fish() -> &'static str {
    r#"# Add to your shell profile: arc shell-init | source
# arc shell integration (fish)

function claude
  set -l config_dir (arc _resolve-config-dir 2>/dev/null)
  if test -n "$config_dir"
    set -x CLAUDE_CONFIG_DIR $config_dir
    command claude $argv
    set -e CLAUDE_CONFIG_DIR
  else
    command claude $argv
  end
end
"#
}

fn generate_powershell() -> &'static str {
    "function claude { $configDir = & arc _resolve-config-dir 2>$null; if ($configDir) { $env:CLAUDE_CONFIG_DIR = $configDir; try { & (Get-Command claude -CommandType Application).Source @args } finally { Remove-Item Env:\\CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue } } else { & (Get-Command claude -CommandType Application).Source @args } }\n"
}

pub fn handle_shell_init(shell: Option<&str>) -> Result<()> {
    let shell_type = if let Some(s) = shell {
        match parse_shell_type(s) {
            Some(t) => t,
            None => {
                eprintln!(
                    "Unknown shell type \"{}\". Supported: bash, zsh, fish, powershell",
                    s
                );
                std::process::exit(1);
            }
        }
    } else {
        detect_shell()
    };

    let output = match shell_type {
        ShellType::Bash | ShellType::Zsh => generate_bash(),
        ShellType::Fish => generate_fish(),
        ShellType::Powershell => generate_powershell(),
    };

    print!("{}", output);
    Ok(())
}
