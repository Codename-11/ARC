# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ARC, please report it responsibly.

**Do not open a public issue.** Instead, use one of the following:

- **GitHub Security Advisory:** [Report a vulnerability](https://github.com/Codename-11/ARC/security/advisories/new)
- **Email:** Open a private advisory on the repository

## Scope

ARC manages authentication credentials (OAuth tokens, API keys) and interfaces with OS keyrings. Security issues in these areas are taken seriously:

- Credential leakage between profiles
- Insecure storage of API keys or tokens
- Environment variable exposure
- Shell injection via profile names or config values
- Symlink/junction attacks on the shared layer

## Response

We aim to acknowledge reports within 48 hours and provide a fix or mitigation plan within 7 days for confirmed issues.
