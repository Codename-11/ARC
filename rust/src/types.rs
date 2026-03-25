use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum AuthType {
    OAuth,
    ApiKey,
    Bedrock,
    Vertex,
    Foundry,
}

impl std::fmt::Display for AuthType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthType::OAuth => write!(f, "oauth"),
            AuthType::ApiKey => write!(f, "api-key"),
            AuthType::Bedrock => write!(f, "bedrock"),
            AuthType::Vertex => write!(f, "vertex"),
            AuthType::Foundry => write!(f, "foundry"),
        }
    }
}

impl std::str::FromStr for AuthType {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "oauth" => Ok(AuthType::OAuth),
            "api-key" => Ok(AuthType::ApiKey),
            "bedrock" => Ok(AuthType::Bedrock),
            "vertex" => Ok(AuthType::Vertex),
            "foundry" => Ok(AuthType::Foundry),
            other => Err(anyhow::anyhow!(
                "Invalid auth type \"{}\". Must be one of: oauth, api-key, bedrock, vertex, foundry.",
                other
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub auth_type: AuthType,
    pub tool: Option<String>,
    pub config_dir: String,
    pub description: Option<String>,
    pub created_at: String,
    pub api_key_storage: Option<String>,
    pub env_overrides: Option<HashMap<String, String>>,
    pub use_shared: Option<bool>,
    pub use_shared_memory: Option<bool>,
    pub use_shared_projects: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArcConfig {
    pub version: u32,
    pub active_profile: String,
    pub profiles: HashMap<String, Profile>,
}
