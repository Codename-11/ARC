use anyhow::Result;
use std::collections::HashMap;
use std::path::Path;

use crate::keyring::retrieve_secret;
use crate::types::{AuthType, Profile};

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct CredentialStatus {
    pub authenticated: bool,
    pub auth_type: AuthType,
    pub email: Option<String>,
    pub expires_at: Option<i64>,
    pub expired: Option<bool>,
    pub method: String,
}

struct OAuthCredentials {
    #[allow(dead_code)]
    access_token: String,
    #[allow(dead_code)]
    refresh_token: String,
    expires_at: i64,
}

fn read_oauth_credentials(config_dir: &str) -> Option<OAuthCredentials> {
    let cred_path = Path::new(config_dir).join(".credentials.json");
    let raw = std::fs::read_to_string(&cred_path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let obj = parsed.as_object()?;

    // Try claudeAiOauth format first, then oauthAccount
    let oauth_data = obj
        .get("claudeAiOauth")
        .or_else(|| obj.get("oauthAccount"))?;

    let creds = oauth_data.as_object()?;
    let access_token = creds.get("accessToken")?.as_str()?.to_string();
    let refresh_token = creds.get("refreshToken")?.as_str()?.to_string();
    let expires_at = creds.get("expiresAt")?.as_i64()?;

    Some(OAuthCredentials {
        access_token,
        refresh_token,
        expires_at,
    })
}

fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn get_credential_status(profile: &Profile) -> Result<CredentialStatus> {
    match &profile.auth_type {
        AuthType::OAuth => {
            let creds = read_oauth_credentials(&profile.config_dir);
            match creds {
                None => Ok(CredentialStatus {
                    authenticated: false,
                    auth_type: AuthType::OAuth,
                    email: None,
                    expires_at: None,
                    expired: None,
                    method: "oauth".to_string(),
                }),
                Some(c) => {
                    let now = now_millis();
                    let expired = c.expires_at < now;
                    Ok(CredentialStatus {
                        authenticated: !expired,
                        auth_type: AuthType::OAuth,
                        email: None,
                        expires_at: Some(c.expires_at),
                        expired: Some(expired),
                        method: "oauth".to_string(),
                    })
                }
            }
        }
        AuthType::ApiKey => {
            // Check env overrides first
            if profile
                .env_overrides
                .as_ref()
                .and_then(|o| o.get("ANTHROPIC_API_KEY"))
                .is_some()
            {
                return Ok(CredentialStatus {
                    authenticated: true,
                    auth_type: AuthType::ApiKey,
                    email: None,
                    expires_at: None,
                    expired: None,
                    method: "env-var".to_string(),
                });
            }

            // Check keyring / fallback file using last segment of config_dir as profile name
            let profile_name = Path::new(&profile.config_dir)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            let secret = retrieve_secret(profile_name);

            Ok(CredentialStatus {
                authenticated: secret.is_some(),
                auth_type: AuthType::ApiKey,
                email: None,
                expires_at: None,
                expired: None,
                method: "api-key".to_string(),
            })
        }
        AuthType::Bedrock => {
            let has_overrides = profile
                .env_overrides
                .as_ref()
                .map(|o| {
                    o.contains_key("AWS_ACCESS_KEY_ID") || o.contains_key("AWS_PROFILE")
                })
                .unwrap_or(false);
            Ok(CredentialStatus {
                authenticated: has_overrides,
                auth_type: AuthType::Bedrock,
                email: None,
                expires_at: None,
                expired: None,
                method: "bedrock".to_string(),
            })
        }
        AuthType::Vertex => {
            let has_overrides = profile
                .env_overrides
                .as_ref()
                .map(|o| {
                    o.contains_key("GOOGLE_APPLICATION_CREDENTIALS")
                        || o.contains_key("CLOUD_ML_REGION")
                })
                .unwrap_or(false);
            Ok(CredentialStatus {
                authenticated: has_overrides,
                auth_type: AuthType::Vertex,
                email: None,
                expires_at: None,
                expired: None,
                method: "vertex".to_string(),
            })
        }
        AuthType::Foundry => {
            let has_overrides = profile
                .env_overrides
                .as_ref()
                .map(|o| o.contains_key("FOUNDRY_API_KEY"))
                .unwrap_or(false);
            Ok(CredentialStatus {
                authenticated: has_overrides,
                auth_type: AuthType::Foundry,
                email: None,
                expires_at: None,
                expired: None,
                method: "foundry".to_string(),
            })
        }
    }
}

// Env vars that select Claude Code's auth mode — must be sanitised to prevent
// cross-profile contamination when the parent shell has leftovers from another profile.
const CLAUDE_AUTH_ENV_VARS: &[&str] = &[
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_FOUNDRY_BASE_URL",
    "ANTHROPIC_FOUNDRY_RESOURCE",
];

/// Build the environment variable map for a profile.
/// Values of `None` mean the variable should be unset.
pub fn build_profile_env(
    profile: &Profile,
    profile_name: &str,
) -> Result<HashMap<String, Option<String>>> {
    let mut env: HashMap<String, Option<String>> = HashMap::new();

    env.insert(
        "CLAUDE_CONFIG_DIR".to_string(),
        Some(profile.config_dir.clone()),
    );

    // Explicitly unset all auth-related env vars
    for &key in CLAUDE_AUTH_ENV_VARS {
        env.insert(key.to_string(), None);
    }

    match &profile.auth_type {
        AuthType::ApiKey => {
            if let Some(secret) = retrieve_secret(profile_name) {
                env.insert("ANTHROPIC_API_KEY".to_string(), Some(secret));
            }
        }
        AuthType::Bedrock => {
            env.insert(
                "CLAUDE_CODE_USE_BEDROCK".to_string(),
                Some("1".to_string()),
            );
        }
        AuthType::Vertex => {
            env.insert(
                "CLAUDE_CODE_USE_VERTEX".to_string(),
                Some("1".to_string()),
            );
        }
        AuthType::Foundry => {
            env.insert(
                "CLAUDE_CODE_USE_FOUNDRY".to_string(),
                Some("1".to_string()),
            );
        }
        AuthType::OAuth => {
            // OAuth uses credentials file in configDir — no extra env needed
        }
    }

    // Apply profile-level env overrides (always win)
    if let Some(overrides) = &profile.env_overrides {
        for (key, value) in overrides {
            env.insert(key.clone(), Some(value.clone()));
        }
    }

    Ok(env)
}
