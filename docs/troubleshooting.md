# Troubleshooting

## `arc` command not found after install

**npm global install:**

Check that npm's global bin directory is on your `PATH`:

```bash
npm prefix -g        # e.g. /usr/local or C:\Users\You\AppData\Roaming\npm
```

Add `<prefix>/bin` (macOS/Linux) or `<prefix>` (Windows) to your `PATH`.

**Local checkout (Windows):**

Run `pnpm install:local` to build and install shims into `~\.local\bin`. This also adds that directory to your user `PATH` if needed. To remove: `pnpm uninstall:local`.

**Bootstrap install:**

The bootstrap puts shims in `~/.local/bin`. If that directory was just added to `PATH`, you need to open a new terminal for the change to take effect.

---

## Shell wrapper not working after `arc setup`

Open a **new** terminal session — `setup` modifies your shell profile file, which only takes effect in new sessions.

To load immediately without opening a new terminal:

```bash
# bash / zsh
source ~/.bashrc   # or ~/.zshrc

# fish
source ~/.config/fish/config.fish

# PowerShell
. $PROFILE
```

---

## PowerShell: `Invoke-Expression` fails with multi-line output

Use `| Out-String | Invoke-Expression` instead of `| Invoke-Expression`:

```powershell
# Correct
arc shell-init --shell powershell | Out-String | Invoke-Expression

# Broken — fails on multi-line output
arc shell-init --shell powershell | Invoke-Expression
```

`arc setup` writes the correct form automatically.

---

## OAuth token expired / re-authentication required

OAuth tokens are managed by the agent tool itself. If your token expires:

```bash
arc launch <name>
```

The tool will prompt you to re-authenticate in the browser.

---

## API key not found / keyring errors

If the native keyring module is not available (missing build tools), ARC falls back to a plaintext file. Check:

```bash
arc status
```

If the key is missing, re-set it:

```bash
arc set-key <name>
```

To install the native keyring module, ensure build tools are available and reinstall:

```bash
# Windows — install Visual C++ Build Tools, then:
npm install -g @axiom-labs/arc-cli

# macOS
xcode-select --install && npm install -g @axiom-labs/arc-cli

# Linux
sudo apt install build-essential libsecret-1-dev && npm install -g @axiom-labs/arc-cli
```

---

## Wrong profile being used

Check the active profile:

```bash
arc status
arc list
```

Switch the active profile:

```bash
arc use <name>
```

Or launch a specific profile directly:

```bash
arc launch <name>
```

---

## Bedrock / Vertex / Foundry — authentication not detected

`arc status` reports auth as missing for cloud profiles when no env overrides are configured. These profiles rely on environment variables set in `envOverrides` or already present in the parent shell.

Verify the expected env vars are set:

```bash
arc exec <name> -- env | grep -E 'AWS|GOOGLE|FOUNDRY|ANTHROPIC'
```

---

## Profile data after deletion

Profile config directories (`~/.arc/profiles/<name>/`) are removed automatically when you run `arc profile delete`. If you want to remove all ARC data completely:

```bash
arc prune
```

---

## Migration from multicc

ARC uses `~/.arc/` instead of `~/.multicc/` for its data directory. If you have existing multicc profiles, you can re-import them:

```bash
arc profile import --name <name> --from ~/.multicc/profiles/<name> --tool claude
```

Shell integration lines added by multicc (`eval "$(multicc shell-init)"`) should be replaced with the ARC equivalent:

```bash
eval "$(arc shell-init)"
```

---

## PowerShell execution policy error

If you see an error about running scripts:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Then re-run the bootstrap or setup command.
