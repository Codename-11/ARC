# Shell Integration

Shell integration wraps agent tool commands so they automatically use the active ARC profile — no need to call `arc launch` manually every time.

## Setup

Run once to install shims and add the integration line to your shell profile:

```bash
arc setup
```

This:
1. Installs the `arc` shim into `~/.local/bin` (or equivalent) and adds it to `PATH` if needed
2. Appends the shell integration line to your shell's profile file
3. Detects your shell automatically

Open a new terminal after setup completes.

## Manual integration

### bash / zsh

Add to `~/.bashrc` or `~/.zshrc`:

```bash
eval "$(arc shell-init)"
```

Or with an explicit shell:

```bash
eval "$(arc shell-init --shell bash)"
eval "$(arc shell-init --shell zsh)"
```

### fish

Add to `~/.config/fish/config.fish`:

```fish
arc shell-init --shell fish | source
```

### PowerShell

Add to your PowerShell profile (`$PROFILE`):

```powershell
arc shell-init --shell powershell | Out-String | Invoke-Expression
```

> **Note:** The `| Out-String` step is required. Piping a multi-line string directly to `Invoke-Expression` in PowerShell fails — `Out-String` collapses it to a single evaluable block.

Or run setup to have it added automatically:

```powershell
arc setup
```

## How it works

The integration installs shell functions that:

1. Call `arc _resolve-config-dir` to get the active profile's config directory
2. Set the appropriate env var (`CLAUDE_CONFIG_DIR`, etc.) for the tool
3. Invoke the real tool binary with the original arguments
4. Clean up the env var after the process exits (PowerShell and fish)

Currently the `claude` wrapper is installed. Additional wrappers for `gemini` and `codex` will follow as those tool integrations mature.

## Shell options

```bash
arc setup --shell bash        # Force bash integration
arc setup --shell zsh
arc setup --shell fish
arc setup --shell powershell
arc setup --no-shell          # Skip shell profile modification
```

## Profile resolution order

When a tool command is invoked via the shell wrapper:

1. `ARC_PROFILE` env var (if set — useful for scripts)
2. Active profile in `~/.arc/config.json`
3. No override (falls through to bare tool invocation)
