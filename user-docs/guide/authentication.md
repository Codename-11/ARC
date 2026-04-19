# Authentication

ARC supports all standard authentication methods across agent tools. Auth type is set per-profile at creation time.

## OAuth <Badge type="tip" text="default" />

Sign in with a browser account. This is the default for Claude Code.

```bash
arc create personal --tool claude --auth-type oauth
arc launch personal      # Browser window opens on first run
```

Credentials are stored in `~/.arc/profiles/<name>/.credentials.json` and refreshed automatically by the agent tool.

## API Key

Use a provider API key. Keys are stored in the OS keyring when available, with a plaintext file fallback.

```bash
arc create work --tool claude --auth-type api-key
arc set-key work         # Prompts for key and saves it

arc create gemini-work --tool gemini --auth-type api-key
arc set-key gemini-work
```

Pass a key from an existing environment variable:

```bash
arc set-key work --from-env ANTHROPIC_API_KEY
```

### Keyring Storage

ARC uses [`@napi-rs/keyring`](https://github.com/nicolo-ribaudo/napi-rs-keyring) for secure key storage:

| Platform | Backend |
|----------|---------|
| macOS | Keychain |
| Windows | Credential Manager |
| Linux | Secret Service (libsecret) |

Keyring service name format: `arc/<profile-name>`

If the native keyring is unavailable, keys fall back to `~/.arc/profiles/<name>/.api-key`.

## AWS Bedrock

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

## Google Vertex AI

Use Claude through Google Cloud Vertex AI.

```bash
arc create gcp --tool claude --auth-type vertex
```

ARC sets `CLAUDE_CODE_USE_VERTEX=1`. Required environment variables:

| Variable | Description |
|----------|-------------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON |
| `CLOUD_ML_REGION` | Vertex AI region |
| `ANTHROPIC_VERTEX_PROJECT_ID` | GCP project ID |

## Foundry

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

## OpenAI-Compatible Providers

Connect any OpenAI-compatible API (OpenRouter, Ollama, LM Studio, Together AI, Groq, MiniMax, DeepSeek, and more).

```bash
arc create openrouter --tool openai-compat --auth-type openai-compat
arc provider set openrouter --base-url https://openrouter.ai/api/v1 --model anthropic/claude-sonnet-4
arc set-key openrouter
```

ARC injects `OPENAI_BASE_URL` and `OPENAI_API_KEY` into the agent tool's environment.

| Variable | Description |
|----------|-------------|
| `OPENAI_BASE_URL` | API endpoint from provider config |
| `OPENAI_API_KEY` | API key (stored via `arc set-key`) |
| `OPENAI_MODEL` | Model identifier from provider config |

Run `arc provider presets` to see all known presets with their default base URLs and models.

### Local Models

For Ollama, LM Studio, or other local inference servers, no API key is needed:

```bash
arc create local --tool openai-compat --auth-type openai-compat
arc provider set local --base-url http://localhost:11434/v1 --model llama3 --display-name Ollama
arc launch local
```

## Encrypted Secrets

ARC includes an encrypted secret store for arbitrary key-value secrets, using Argon2id KDF and AES-256-GCM per-entry encryption.

```bash
arc secret set MY_TOKEN "secret-value"
arc secret get MY_TOKEN
arc secret list
arc secret delete MY_TOKEN
```

Secrets are encrypted at rest and can be referenced by profiles during launch.

## Env Isolation

When launching a profile, ARC explicitly **unsets all auth-related environment variables** from the parent shell before injecting the profile's values. This prevents credentials from a different profile or shell session leaking into the child process.

Variables cleared before every launch:

- `CLAUDE_CODE_USE_BEDROCK`
- `CLAUDE_CODE_USE_VERTEX`
- `CLAUDE_CODE_USE_FOUNDRY`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_FOUNDRY_BASE_URL`
- `ANTHROPIC_FOUNDRY_RESOURCE`

::: warning
Env isolation only applies when launching via `arc launch` or the shell wrapper. Running the tool binary directly bypasses ARC's env setup.
:::
