# Shell Integration

Shell integration wraps agent tool commands so they automatically use the active ARC profile. No need to call `arc launch` manually every time.

## Setup

Run once to install shims and add the integration line to your shell profile:

```bash
arc setup
```

This:
1. Installs the `arc` shim into `~/.local/bin` (or equivalent) and adds it to `PATH`
2. Appends the shell integration line to your shell's profile file
3. Detects your shell automatically

Open a new terminal after setup completes.

## Manual Integration

::: code-group

```bash [bash / zsh]
# Add to ~/.bashrc or ~/.zshrc
eval "$(arc shell-init)"
```

```fish [fish]
# Add to ~/.config/fish/config.fish
arc shell-init --shell fish | source
```

```powershell [PowerShell]
# Add to your $PROFILE
arc shell-init --shell powershell | Out-String | Invoke-Expression
```

:::

::: tip PowerShell Note
The `| Out-String` step is required. Piping a multi-line string directly to `Invoke-Expression` in PowerShell fails. `Out-String` collapses it to a single evaluable block.
:::

## How It Works

The integration installs shell functions that:

1. Call `arc _resolve-config-dir` to get the active profile's config directory
2. Set the appropriate env var (`CLAUDE_CONFIG_DIR`, etc.) for the tool
3. Invoke the real tool binary with the original arguments
4. Clean up the env var after the process exits (PowerShell and fish)

Currently the `claude` wrapper is installed. Additional wrappers for `gemini` and `codex` follow as those tool integrations mature.

## Shell Options

```bash
arc setup --shell bash        # Force bash integration
arc setup --shell zsh
arc setup --shell fish
arc setup --shell powershell
arc setup --no-shell          # Skip shell profile modification
```

## Profile Resolution Order

When a tool command is invoked via the shell wrapper:

1. `ARC_PROFILE` env var (if set — useful for scripts)
2. Workspace `arc.json` (if present in cwd or parent)
3. Active profile in `~/.arc/config.json`
4. No override (falls through to bare tool invocation)

## Scripting with ARC_PROFILE

Set `ARC_PROFILE` to override which profile is used without modifying `config.json`:

```bash
ARC_PROFILE=work claude --help
ARC_PROFILE=gemini-work gemini --version
```

This works with both the shell wrapper and `arc launch`.

## Subshell

Open a new shell with the profile's environment already active:

```bash
arc shell [name]
```

If `name` is omitted, the active profile is used. Exit normally (`exit` or Ctrl+D) to return.

## Exec

Run any command with a profile's environment variables injected, without launching the agent tool:

```bash
arc exec <name> -- <command> [args...]

# Examples
arc exec work -- claude --help
arc exec work -- env | grep CLAUDE
arc exec aws -- aws sts get-caller-identity
```

Useful for scripts, CI pipelines, or any tool that reads auth env vars.
