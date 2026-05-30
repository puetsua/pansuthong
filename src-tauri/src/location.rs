//! Device-local persistence of the user's chosen data-file folder.
//!
//! The chosen folder is stored in `<default app_data_dir>/data_location.json`,
//! which is NEVER synced (it lives in app-private storage, separate from the
//! possibly-relocated tasks.json). This avoids a device-specific path leaking
//! into the synced document.

use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const SIDECAR: &str = "data_location.json";
const DATA_FILE: &str = "tasks.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DataLocationConfig {
    /// Absolute folder path chosen by the user; `None` = use the default dir.
    pub folder: Option<String>,
}

fn sidecar_path(default_dir: &Path) -> PathBuf {
    default_dir.join(SIDECAR)
}

pub fn load(default_dir: &Path) -> DataLocationConfig {
    std::fs::read(sidecar_path(default_dir))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save(default_dir: &Path, cfg: &DataLocationConfig) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(cfg)?;
    std::fs::write(sidecar_path(default_dir), bytes)?;
    Ok(())
}

/// Resolve the effective tasks.json path: `<folder>/tasks.json` if a valid
/// folder is configured, else `<default_dir>/tasks.json`.
pub fn resolve_data_path(default_dir: &Path) -> PathBuf {
    let cfg = load(default_dir);
    match cfg.folder {
        Some(ref f) if Path::new(f).is_dir() => Path::new(f).join(DATA_FILE),
        _ => default_dir.join(DATA_FILE),
    }
}
