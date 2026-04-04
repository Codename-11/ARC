# Credential Hot-Swap

::: warning Experimental
Credential hot-swap is an experimental feature. The API and behavior may change in future releases.
:::

ARC's hot-swap system lets you switch between multiple authenticated accounts for the same tool without re-authenticating. It works by capturing credential snapshots and swapping them into the tool's canonical config directory.

## Why Hot-Swap?

Desktop applications like Claude Desktop, Gemini, and Codex read credentials from a single canonical directory (e.g., `~/.claude/`). ARC profiles use isolated config directories, but desktop apps ignore those overrides. Hot-swap bridges this gap by copying the right credentials into the canonical location.

## Capturing Credentials

Capture your current credentials as a named account:

```bash
# Capture from Claude's canonical config dir
arc swap capture personal --tool claude

# Capture a work account
arc swap capture work --tool claude
```

ARC copies the credential files into `~/.arc/credentials/<account>/` and records metadata (account tier, subscription type) when available.

## Swapping Accounts

Switch to a previously captured account:

```bash
arc swap to work
```

This saves the current credentials as the active account (so you can swap back), then restores the target account's credentials into the canonical directory. If the restore fails, ARC rolls back automatically.

## Listing Accounts

```bash
arc swap list
```

Shows all captured accounts with their tool, active status, and capture date.

## Checking Status

```bash
arc swap status
```

Shows which account is currently active for each supported tool (Claude, Gemini, Codex).

## Swapping from a Profile

Bridge an ARC profile's isolated credentials to the canonical directory:

```bash
arc swap from-profile my-profile --tool claude
```

This copies credentials from the profile's `configDir` into the tool's canonical location, making them available to desktop apps.

## Deleting a Snapshot

```bash
arc swap delete old-account
```

You cannot delete the currently active account. Swap to a different account first.

## Supported Tools

| Tool | Canonical Dir | Credential Files |
|------|--------------|-----------------|
| Claude | `~/.claude/` | `.credentials.json` |
| Gemini | `~/.gemini/` | `oauth_creds.json`, `google_accounts.json` |
| Codex | `~/.codex/` | `auth.json` |

## Typical Workflow

1. Authenticate with your personal account: `arc auth login personal-profile`
2. Capture the credentials: `arc swap capture personal --tool claude`
3. Authenticate with your work account: `arc auth login work-profile`
4. Capture those too: `arc swap capture work --tool claude`
5. Now swap freely between them:

```bash
arc swap to personal   # Claude Desktop uses personal account
arc swap to work       # Claude Desktop uses work account
```

## Safety

- Swap saves the current credentials before overwriting, so you can always swap back
- Failed swaps are rolled back automatically
- Credential files are written with `0600` permissions (owner-only read/write)
- Snapshots are stored separately from profile config dirs

## Storage

- **Snapshots** — `~/.arc/credentials/<account>/`
- **Manifest** — `~/.arc/credentials/swap-manifest.json`

The TUI also provides a SwapOverlay accessible through the command palette for interactive swapping.
