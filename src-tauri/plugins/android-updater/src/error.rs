use serde::Deserialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("{0}")]
    Msg(String),
    #[error(transparent)]
    Ureq(#[from] ureq::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginConfig {
    pub endpoints: Option<Vec<String>>,
}

impl PluginConfig {
    pub fn dev_endpoint(&self) -> Option<&str> {
        self.endpoints
            .as_ref()
            .and_then(|e| e.first())
            .map(|s| s.as_str())
    }
}
