# Secrets & Credentials

ARC provides a secure, encrypted secret store for API keys, tokens, and sensitive values. Secrets are protected with a master password using Argon2id key derivation and AES-256-GCM per-entry encryption.

## Storing a Secret

```bash
# Interactive prompt (default — value never appears in shell history)
arc secret set OPENAI_API_KEY

# Pipe from stdin
echo "sk-..." | arc secret set OPENAI_API_KEY --from-stdin

# Read from a file
arc secret set OPENAI_API_KEY --from-file ./key.txt
```

The first time you use the store, you will be prompted to create a master password. This password is required for all subsequent operations and is cached for the duration of the session.

## Retrieving a Secret

```bash
arc secret get OPENAI_API_KEY

# Machine-readable output (no decoration)
arc secret get OPENAI_API_KEY --quiet
```

## Listing Secrets

```bash
arc secret list
arc secret list --json
```

The table shows each secret's name, creation date, and last-updated date. Secret values are never displayed in the list.

## Deleting a Secret

```bash
# Interactive confirmation
arc secret delete OPENAI_API_KEY

# Skip confirmation (for scripts)
arc secret delete OPENAI_API_KEY --force
```

## Encryption Details

The vault uses a layered encryption design:

| Component | Algorithm | Purpose |
|-----------|-----------|---------|
| Key derivation | Argon2id | Derives encryption key from master password |
| Per-entry encryption | AES-256-GCM | Encrypts each secret independently |
| Storage | `vault.enc` | Single encrypted file at `~/.arc/secrets/vault.enc` |

Each secret is encrypted individually, so decrypting one entry does not expose others. The Argon2id KDF provides resistance against brute-force and GPU-based attacks.

## Authentication Commands

ARC also manages per-profile authentication through the `arc auth` command group:

```bash
# Show auth status for all profiles
arc auth status

# Detailed status for a single profile
arc auth status my-profile
arc auth status my-profile --json

# Log in with a profile's tool (launches OAuth flow)
arc auth login my-profile

# Check refresh token status
arc auth refresh my-profile

# Show current identity
arc auth whoami
arc auth whoami my-profile --json
```

Supported auth methods include OAuth, API key, environment variable, AWS Bedrock, GCP Vertex, and Azure Foundry.

## Per-Profile Credential Isolation

Each ARC profile has its own `configDir` with isolated credential storage. When you launch a profile, ARC sets environment variables so the agent tool reads credentials from the profile's directory rather than the global default. This means:

- Multiple accounts for the same tool coexist safely
- Credentials never leak between profiles
- Each profile can use a different auth method (OAuth vs. API key)

## Credential Hot-Swap Bridge

For desktop applications that read from a single canonical config directory, the [credential hot-swap](/features/swap) system can copy credentials from a profile's isolated directory into the canonical location. This bridges per-profile isolation with tools that do not support config dir overrides.

## Storage

- **Encrypted vault** — `~/.arc/secrets/vault.enc`
- **Profile credentials** — `~/.arc/profiles/<name>/` (isolated per profile)
- **Swap snapshots** — `~/.arc/credentials/<account>/` (for hot-swap)
