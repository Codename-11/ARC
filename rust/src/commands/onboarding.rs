use anyhow::Result;
use std::io::{self, BufRead, Write};

use crate::detect::detect_tool_configs;
use crate::display::{get_large_banner, section_header};

fn is_interactive() -> bool {
    // On Unix, check isatty; on Windows, assume interactive unless piped
    #[cfg(unix)]
    {
        extern "C" {
            fn isatty(fd: i32) -> i32;
        }
        unsafe { isatty(0) != 0 }
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn prompt_line(prompt: &str) -> String {
    print!("{}", prompt);
    let _ = io::stdout().flush();
    let stdin = io::stdin();
    let mut line = String::new();
    let _ = stdin.lock().read_line(&mut line);
    line.trim().to_string()
}

fn prompt_default(prompt: &str, default: &str) -> String {
    let input = prompt_line(&format!("{} [{}]: ", prompt, default));
    if input.is_empty() {
        default.to_string()
    } else {
        input
    }
}

fn prompt_yn(prompt: &str, default: bool) -> bool {
    let hint = if default { "Y/n" } else { "y/N" };
    let input = prompt_line(&format!("{} ({}): ", prompt, hint));
    if input.is_empty() {
        return default;
    }
    matches!(input.to_lowercase().as_str(), "y" | "yes")
}

fn prompt_select(prompt: &str, choices: &[(&str, &str)], default_idx: usize) -> usize {
    println!("{}", prompt);
    for (i, (_key, label)) in choices.iter().enumerate() {
        let marker = if i == default_idx { ">" } else { " " };
        println!("  {}  {}) {}", marker, i + 1, label);
    }
    print!("Choice [{}]: ", default_idx + 1);
    let _ = io::stdout().flush();

    let stdin = io::stdin();
    let mut line = String::new();
    let _ = stdin.lock().read_line(&mut line);
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return default_idx;
    }
    if let Ok(n) = trimmed.parse::<usize>() {
        if n >= 1 && n <= choices.len() {
            return n - 1;
        }
    }
    default_idx
}

fn validate_profile_name(name: &str) -> Option<String> {
    if name.is_empty() {
        return Some("Profile name cannot be empty.".to_string());
    }
    if name.len() > 32 {
        return Some("Profile name must be 32 characters or less.".to_string());
    }
    let valid = name
        .chars()
        .next()
        .map(|c| c.is_alphanumeric())
        .unwrap_or(false)
        && name.chars().all(|c| c.is_alphanumeric() || c == '-');
    if !valid {
        return Some(
            "Must be alphanumeric with hyphens only, starting with a letter or number."
                .to_string(),
        );
    }
    None
}

fn print_next_steps(profile_name: &str, auth_type: &str, tool: &str) {
    section_header("Next Steps");
    println!();

    let mut step = 1;

    match auth_type {
        "api-key" => {
            println!("  {}. Store API key       arc set-key {}", step, profile_name);
            step += 1;
        }
        "bedrock" | "vertex" | "foundry" => {
            println!(
                "  {}. Configure           See docs for {} environment variables",
                step, auth_type
            );
            step += 1;
        }
        _ => {}
    }

    println!("  {}. Launch {}       arc launch {}", step, tool, profile_name);
    step += 1;
    println!("  {}. Shell setup          arc setup", step);
    println!();
    println!("  Run \"arc --help\" for all available commands.");
    println!();
}

pub fn handle_onboarding() -> Result<()> {
    println!();
    println!("{}", get_large_banner());
    println!();

    if !is_interactive() {
        // Non-interactive fallback
        let detected = detect_tool_configs();

        println!("  Welcome to ARC! No profiles configured yet.");
        println!();
        println!("  To get started, create your first profile:");
        println!();
        println!("    arc profile create <name> --auth-type oauth");
        println!();

        if !detected.is_empty() {
            if detected.len() == 1 {
                println!(
                    "  Or import your existing {} config:",
                    detected[0].display_name
                );
                println!();
                println!("    arc import --name {}", detected[0].tool);
            } else {
                println!("  Or import detected tool configs:");
                println!();
                for dt in &detected {
                    println!(
                        "    arc import --name {} --from {} --tool {}",
                        dt.tool,
                        dt.config_dir.display(),
                        dt.tool
                    );
                }
                println!();
                println!("  Or import all at once:");
                println!();
                println!("    arc import --all");
            }
            println!();
        }

        println!("  Run \"arc --help\" for all available commands.");
        println!();
        return Ok(());
    }

    // Interactive wizard
    println!("  Welcome! Let's set up your first profile.");
    println!();
    println!("  ARC manages profiles for Claude, Gemini, Codex, and other agent CLIs.");
    println!();

    // Detect existing configs
    let detected = detect_tool_configs();

    if !detected.is_empty() {
        for dt in &detected {
            println!(
                "  Found existing {} config at {}",
                dt.display_name,
                dt.config_dir.display()
            );
        }
        println!();

        if detected.len() == 1 {
            let dt = &detected[0];
            let should_import = prompt_yn(
                &format!("Import existing {} config into ARC?", dt.display_name),
                true,
            );
            if should_import {
                crate::commands::profile::handle_import(
                    crate::commands::profile::ImportOptions {
                        name: dt.tool.clone(),
                        from: Some(dt.config_dir.to_string_lossy().to_string()),
                        tool: Some(dt.tool.clone()),
                        force: false,
                    },
                )?;
                println!();
                print_next_steps(&dt.tool, "oauth", &dt.tool);
                return Ok(());
            }
        } else {
            let mut choices: Vec<(&str, String)> = vec![("all", "Import all detected configs".to_string())];
            let tool_labels: Vec<String> = detected
                .iter()
                .map(|dt| format!("Import {} only", dt.display_name))
                .collect();
            for label in &tool_labels {
                choices.push(("tool", label.clone()));
            }
            choices.push(("skip", "Skip import, create a new profile".to_string()));

            let static_choices: Vec<(&str, &str)> = choices
                .iter()
                .map(|(k, v)| (*k, v.as_str()))
                .collect();

            let idx = prompt_select("Multiple tool configs detected. What would you like to do?", &static_choices, 0);

            let choice_key = static_choices[idx].0;
            if choice_key != "skip" {
                let to_import: Vec<&crate::detect::DetectedTool> = if idx == 0 {
                    detected.iter().collect()
                } else if idx <= detected.len() {
                    vec![&detected[idx - 1]]
                } else {
                    vec![]
                };

                for dt in &to_import {
                    crate::commands::profile::handle_import(
                        crate::commands::profile::ImportOptions {
                            name: dt.tool.clone(),
                            from: Some(dt.config_dir.to_string_lossy().to_string()),
                            tool: Some(dt.tool.clone()),
                            force: false,
                        },
                    )?;
                }

                println!();
                if let Some(last) = to_import.last() {
                    print_next_steps(&last.tool, "oauth", &last.tool);
                }
                return Ok(());
            }
        }
        println!();
    }

    // Profile name
    let profile_name;
    loop {
        let input = prompt_default("Profile name", "default");
        if let Some(err) = validate_profile_name(&input) {
            println!("  Error: {}", err);
        } else {
            profile_name = input;
            break;
        }
    }

    // Agent tool
    let tool_choices = [
        ("claude", "Claude Code (claude.ai / Anthropic)"),
        ("gemini", "Gemini CLI (Google)"),
        ("codex", "Codex CLI (OpenAI)"),
        ("other", "Other / custom binary"),
    ];
    let tool_idx = prompt_select("Agent tool:", &tool_choices, 0);
    let tool_binary = if tool_choices[tool_idx].0 == "other" {
        prompt_default("Binary name or path", "claude")
    } else {
        tool_choices[tool_idx].0.to_string()
    };

    // Auth type
    let auth_choices = [
        ("oauth", "OAuth (browser sign-in)"),
        ("api-key", "API Key"),
        ("bedrock", "AWS Bedrock"),
        ("vertex", "Google Vertex AI"),
        ("foundry", "Foundry"),
    ];
    let auth_idx = prompt_select("Authentication type:", &auth_choices, 0);
    let auth_type = auth_choices[auth_idx].0;

    // Description
    let desc_input = prompt_line("Description (optional, press Enter to skip): ");
    let description = if desc_input.is_empty() {
        None
    } else {
        Some(desc_input.as_str())
    };

    println!();

    crate::commands::profile::handle_create(
        &profile_name,
        Some(auth_type),
        Some(&tool_binary),
        description,
    )?;

    println!();
    print_next_steps(&profile_name, auth_type, &tool_binary);

    Ok(())
}
