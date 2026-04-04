# Troubleshooting

Common issues and how to fix them.

## `arc` command not found

Your `PATH` does not include the ARC binary location.

```bash
arc setup
```

This installs shims into `~/.local/bin` and adds them to your `PATH`. Open a new terminal after running it.

If you installed via npm globally, verify the global bin directory is on your `PATH`:

```bash
npm prefix -g
```

Add `<prefix>/bin` (macOS/Linux) or `<prefix>` (Windows) to your shell profile.

::: tip
Run `which arc` (Unix) or `Get-Command arc` (PowerShell) to confirm the binary is resolvable.
:::

## Shell wrapper not working

The shell wrapper intercepts tool commands so they use the active profile automatically. If it stops working:

```bash
arc setup
```

Then open a **new** terminal. The setup command modifies your shell profile file, which only takes effect in new sessions.

To reload without restarting:

::: code-group

```bash [bash / zsh]
source ~/.bashrc   # or ~/.zshrc
```

```fish [fish]
source ~/.config/fish/config.fish
```

```powershell [PowerShell]
. $PROFILE
```

:::

Verify integration is active:

```bash
eval "$(arc shell-init bash)"
```

::: warning
PowerShell users must use `| Out-String | Invoke-Expression`, not `| Invoke-Expression` directly. `arc setup` writes the correct form automatically.
:::

## Keyring unavailable

ARC uses the OS keyring for storing secrets. If the native keyring module is not available, ARC falls back to a plaintext file.

Check status:

```bash
arc status
```

To install native keyring support:

| Platform | Command |
|----------|---------|
| Windows | Install Visual C++ Build Tools, then reinstall ARC |
| macOS | `xcode-select --install` then reinstall ARC |
| Linux | `sudo apt install build-essential libsecret-1-dev` then reinstall ARC |

::: warning
On Linux, `libsecret` and a running secret service (GNOME Keyring, KWallet) are required. Headless servers typically lack these — the plaintext fallback is used instead. Ensure credential files have `0600` permissions.
:::

On Windows, verify Windows Credential Manager is running: open Start, search "Credential Manager", and confirm it loads.

## OAuth credentials expired

OAuth tokens are managed by the agent tool itself. Re-authenticate:

```bash
arc auth login <profile>
```

This opens a browser flow to refresh the token. If the tool supports CLI-only auth, pass `--no-browser`.

::: tip
Use `arc status` to check which profiles have expired or missing credentials.
:::

## Hook timeout / circuit breaker triggered

Hooks have a default timeout. If a hook exceeds it, ARC logs the failure and continues. After 3 consecutive failures, the circuit breaker trips and the hook is bypassed.

Check recent failures:

```bash
arc logs
```

The circuit breaker auto-resets after 5 minutes. To clear it immediately:

```bash
arc hooks reset
```

::: tip
If a hook is consistently slow, increase its timeout in `arc.json` or move expensive logic to an async hook.
:::

## Wrong profile launching

ARC resolves the active profile from multiple sources. Check which profile is in effect and why:

```bash
arc which
```

This shows the resolved profile and its source (global default, project `arc.json`, or `--profile` flag).

Common causes:
- A project-level `arc.json` overrides your global default
- `arc use <name>` was run in a different terminal
- The `--profile` flag was passed explicitly

Fix it:

```bash
# Set the global default
arc use <name>

# Or check for a project-level override
cat arc.json
```

## Dashboard not showing data

The web dashboard requires the ARC server to be running with access to the data stores.

```bash
arc web
```

Do not use a standalone dev server — it won't have access to profile data, session stores, or telemetry.

::: tip
If the dashboard loads but shows empty data, check that at least one profile exists with `arc list`.
:::

## Permission denied on credential files

Credential files should have `0600` permissions (owner read/write only).

```bash
# Check permissions
ls -la ~/.arc/credentials/

# Fix permissions
chmod 600 ~/.arc/credentials/*
```

On Windows, right-click the file, go to Properties > Security, and ensure only your user account has access.

::: warning
If another process or user can read your credential files, rotate the affected secrets immediately with `arc secret set`.
:::
