# Advanced Usage

## exec — Run a command with profile environment

Run any command with a profile's environment variables injected, without launching the agent tool:

```bash
arc exec <name> -- <command> [args...]

# Examples
arc exec work -- claude --help
arc exec work -- env | grep CLAUDE
arc exec aws -- aws sts get-caller-identity
arc exec gemini-work -- gemini --version
```

Useful for scripts, CI pipelines, or any tool that reads auth env vars.

## shell — Open a subshell with profile environment

Opens a new shell with the profile's environment already active:

```bash
arc shell [name]
```

If `name` is omitted, the active profile is used. Exit normally (`exit` or `Ctrl+D`) to return.

## launch — Launch agent tool

```bash
arc launch [name]
arc launch [name] -- <args...>
```

Launches the agent tool configured for the profile (`profile.tool`) with `CLAUDE_CONFIG_DIR` (or equivalent) set to the profile's directory. If `name` is omitted, the active profile is used.

All flags after the profile name (or after `--`) are forwarded to the tool:

```bash
arc launch work --model sonnet
arc launch work -p "explain this code"
arc launch -- --model sonnet        # active profile, pass flags
```

## prune — Remove all arc data

```bash
arc prune
arc prune --force
```

Removes the entire `~/.arc/` directory and clears all keyring entries. This is destructive and cannot be undone. Requires confirmation unless `--force` is passed.

## Env overrides

Profiles support per-profile environment variable overrides stored in `~/.arc/config.json`. These are injected alongside standard auth env vars on every launch.

Example use cases:
- Point a profile at a custom API base URL
- Set `AWS_PROFILE` or `AWS_REGION` for a Bedrock profile
- Pass `ANTHROPIC_VERTEX_PROJECT_ID` for Vertex AI profiles

Overrides are stored in the profile's `envOverrides` field in `config.json`.

## Scripting with ARC_PROFILE

Set `ARC_PROFILE` to override which profile is used without modifying `config.json`:

```bash
ARC_PROFILE=work claude --help
ARC_PROFILE=gemini-work gemini --version
```

This works with both the shell wrapper and `arc launch`.

## Lifecycle commands

```bash
arc setup                  # Install shims, PATH, shell integration
arc update                 # Refresh shims, PATH, and integration
arc uninstall              # Remove shims, PATH, integration (interactive)
arc uninstall --force      # Remove without prompting
```

Or via npm:

```bash
npm run uninstall
npm run uninstall:force
```

This removes:
- The `arc` global npm package (`arccli`)
- Local shims in `~/.local/bin` (or `~\.local\bin` on Windows)
- The `PATH` entry added for the shim directory (Windows only)
- Shell integration lines in your shell profile

Profile data in `~/.arc/` is **not** deleted by uninstall — run `arc prune` first if you want a clean removal.
