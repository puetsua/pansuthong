use serde::{Deserialize, Serialize};

/// Returned to the webview after a successful check (no download URL).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResponse {
    pub version: String,
    pub body: Option<String>,
}

/// Full update resolved by check(); kept in plugin state for download_and_install.
#[derive(Debug, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub body: Option<String>,
    pub download_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevManifest {
    pub version: String,
    #[serde(default)]
    pub notes: Option<String>,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

impl From<UpdateInfo> for UpdateResponse {
    fn from(info: UpdateInfo) -> Self {
        Self {
            version: info.version,
            body: info.body,
        }
    }
}
