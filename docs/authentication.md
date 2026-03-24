# Authentication

ARC supports all Claude Code authentication methods, with the same auth types available for any agent tool profile.

## OAuth (`oauth`)

Sign in with a browser account. This is the default for Claude Code.

```bash
arc create personal --tool claude --auth-type oauth
arc launch personal      # Browser window opens on first run
```

Credentials are stored in `~/.arc/profiles/<name>/.credentials.json` and refreshed automatically by the agent tool.

## API Key (`api-key`)

Use a provider API key. Keys are stored in the OS keyring when available, with a plaintext file fallback.

```bash
arc create work --tool claude --auth-type api-key
arc set-key work         # Prompts for key and saves it

arc create gemini-work --tool gemini --auth-type api-key
arc set-key gemini-work
```

You can also pass the key directly via an env var:

```bash
arc set-key work --from-env ANTHROPIC_API_KEY
```

### Keyring storage

ARC uses [`@napi-rs/keyring`](https://github.com/nicolo-ribaudo/napi-rs-keyring) to store keys securely in:

- **macOS** — Keychain
- **Windows** — Credential Manager
- **Linux** — Secret Service (libsecret)

Keyring service name format: `arc/<profile-name>`

If the native keyring is unavailable, the key falls back to `~/.arc/profiles/<name>/.api-key`.

## AWS Bedrock (`bedrock`)

Use Claude through AWS Bedrock. Requires AWS credentials.

```bash
arc create aws --tool claude --auth-type bedrock
```

ARC sets `CLAUDE_CODE_USE_BEDROCK=1` when launching. Configure credentials via standard AWS environment variables:

| Variable | Description |
|----------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |
| `AWS_PROFILE` | Named AWS profile from `~/.aws/credentials` |
| `AWS_REGION` | AWS region |

## Google Vertex AI (`vertex`)

Use Claude through Google Cloud Vertex AI.

```bash
arc create gcp --tool claude --auth-type vertex
```

ARC sets `CLAUDE_CODE_USE_VERTEX=1`. Configure credentials via:

| Variable | Description |
|----------|-------------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON |
| `CLOUD_ML_REGION` | Vertex AI region |
| `ANTHROPIC_VERTEX_PROJECT_ID` | GCP project ID |

## Foundry (`foundry`)

Use Claude through Anthropic Foundry.

```bash
arc create foundry-prod --tool claude --auth-type foundry
```

ARC sets `CLAUDE_CODE_USE_FOUNDRY=1`. Required variables:

| Variable | Description |
|----------|-------------|
| `FOUNDRY_API_KEY` | Foundry API key |
| `ANTHROPIC_FOUNDRY_BASE_URL` | Foundry endpoint base URL |
| `ANTHROPIC_FOUNDRY_RESOURCE` | Foundry resource name |

## Env Isolation

When launching a profile, ARC explicitly unsets all auth-related environment variables from the parent shell before injecting the profile's values. This prevents credentials from a different profile leaking into the child process.

Variables cleared before every launch:

- `CLAUDE_CODE_USE_BEDROCK`
- `CLAUDE_CODE_USE_VERTEX`
- `CLAUDE_CODE_USE_FOUNDRY`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_FOUNDRY_BASE_URL`
- `ANTHROPIC_FOUNDRY_RESOURCE`
