//! Device-local configuration: the user's chosen data-file folder plus all
//! app settings (theme, sort order, Upcoming horizon).
//!
//! Stored in `<default app_data_dir>/config.json`, which is NEVER synced (it
//! lives in app-private storage, separate from the possibly-relocated
//! tasks.json). Keeping settings here makes them device-local: each device has
//! its own theme/sort/horizon, and a device-specific folder path never leaks
//! into the synced document.

use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const CONFIG_FILE: &str = "config.json";
/// Pre-rename filename, migrated to `config.json` on first launch.
const LEGACY_FILE: &str = "data_location.json";
const DATA_FILE: &str = "tasks.json";

/// App settings. Formerly persisted inside the synced `Document`; now device-local.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub theme: String, // "auto" | "light" | "dark"
    /// Task list ordering: "priority" (weight desc, then date) or "date".
    #[serde(default = "default_sort_order")]
    pub sort_order: String,
    /// How many days ahead the Upcoming view looks. The UI bounds it to 1..=365.
    #[serde(default = "default_upcoming_days")]
    pub upcoming_days: u32,
}

fn default_sort_order() -> String {
    "priority".into()
}

fn default_upcoming_days() -> u32 {
    14
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "auto".into(),
            sort_order: default_sort_order(),
            upcoming_days: default_upcoming_days(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    /// Absolute folder path chosen by the user; `None` = use the default dir.
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub settings: Settings,
}

fn config_path(default_dir: &Path) -> PathBuf {
    default_dir.join(CONFIG_FILE)
}

/// Resolve the effective tasks.json path: `<folder>/tasks.json` if a valid
/// folder is configured, else `<default_dir>/tasks.json`.
pub fn resolve_data_path(default_dir: &Path, folder: &Option<String>) -> PathBuf {
    match folder {
        Some(f) if Path::new(f).is_dir() => Path::new(f).join(DATA_FILE),
        _ => default_dir.join(DATA_FILE),
    }
}

fn persist(path: &Path, cfg: &Config) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(cfg)?;
    std::fs::write(path, bytes)?;
    Ok(())
}

/// Load `config.json`, or migrate to it on first launch after the rename.
///
/// Migration (only when `config.json` is absent):
/// 1. carry the chosen folder forward from a legacy `data_location.json`, and
/// 2. lift the `settings` object out of the existing `tasks.json` so each
///    device keeps the theme/sort/horizon it had before settings became
///    device-local.
/// The migrated config is written to `config.json`; the legacy file is left in
/// place (harmless) so a downgrade still finds it.
pub fn load_or_migrate(default_dir: &Path) -> Config {
    if let Ok(bytes) = std::fs::read(config_path(default_dir)) {
        if let Ok(cfg) = serde_json::from_slice::<Config>(&bytes) {
            return cfg;
        }
    }
    let folder = read_legacy_folder(default_dir);
    let data_path = resolve_data_path(default_dir, &folder);
    let settings = lift_settings_from_tasks(&data_path);
    let cfg = Config { folder, settings };
    let _ = persist(&config_path(default_dir), &cfg);
    cfg
}

/// Read just the `folder` from a legacy `data_location.json`, if present.
fn read_legacy_folder(default_dir: &Path) -> Option<String> {
    #[derive(Deserialize)]
    struct Legacy {
        #[serde(default)]
        folder: Option<String>,
    }
    std::fs::read(default_dir.join(LEGACY_FILE))
        .ok()
        .and_then(|b| serde_json::from_slice::<Legacy>(&b).ok())
        .and_then(|l| l.folder)
}

/// Lift the `settings` object out of an existing tasks.json, defaulting when the
/// file or key is absent.
fn lift_settings_from_tasks(data_path: &Path) -> Settings {
    #[derive(Deserialize)]
    struct LegacyDoc {
        #[serde(default)]
        settings: Settings,
    }
    std::fs::read(data_path)
        .ok()
        .and_then(|b| serde_json::from_slice::<LegacyDoc>(&b).ok())
        .map(|d| d.settings)
        .unwrap_or_default()
}

/// Managed config: holds the in-memory `Config` and the fixed `config.json`
/// path (always the default app-data dir — it never moves with the data folder).
pub struct ConfigState {
    inner: Mutex<Config>,
    path: PathBuf,
}

impl ConfigState {
    pub fn new(default_dir: &Path, config: Config) -> Self {
        Self {
            inner: Mutex::new(config),
            path: config_path(default_dir),
        }
    }

    pub fn settings(&self) -> Settings {
        self.inner.lock().unwrap().settings.clone()
    }

    pub fn folder(&self) -> Option<String> {
        self.inner.lock().unwrap().folder.clone()
    }

    /// Mutate the settings, persist, and return the updated copy.
    pub fn update_settings<F>(&self, f: F) -> Result<Settings>
    where
        F: FnOnce(&mut Settings) -> Result<()>,
    {
        let mut g = self.inner.lock().unwrap();
        f(&mut g.settings)?;
        persist(&self.path, &g)?;
        Ok(g.settings.clone())
    }

    /// Set (or clear) the chosen folder and persist.
    pub fn set_folder(&self, folder: Option<String>) -> Result<()> {
        let mut g = self.inner.lock().unwrap();
        g.folder = folder;
        persist(&self.path, &g)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn load_or_migrate_lifts_settings_from_tasks_json() {
        let dir = tempdir().unwrap();
        // Pre-rename world: no config.json, settings live in tasks.json.
        std::fs::write(
            dir.path().join(DATA_FILE),
            r#"{"tasks":[],"tags":[],"settings":{"theme":"dark","sort_order":"date","upcoming_days":30}}"#,
        )
        .unwrap();

        let cfg = load_or_migrate(dir.path());
        assert_eq!(cfg.folder, None);
        assert_eq!(cfg.settings.theme, "dark");
        assert_eq!(cfg.settings.sort_order, "date");
        assert_eq!(cfg.settings.upcoming_days, 30);

        // config.json was written so the next launch skips migration.
        assert!(config_path(dir.path()).exists());
        let again = load_or_migrate(dir.path());
        assert_eq!(again.settings.theme, "dark");
    }

    #[test]
    fn load_or_migrate_carries_legacy_folder_forward() {
        let dir = tempdir().unwrap();
        let folder = tempdir().unwrap();
        let folder_str = folder.path().to_string_lossy().to_string();
        std::fs::write(
            dir.path().join(LEGACY_FILE),
            format!(r#"{{"folder":{}}}"#, serde_json::to_string(&folder_str).unwrap()),
        )
        .unwrap();

        let cfg = load_or_migrate(dir.path());
        assert_eq!(cfg.folder.as_deref(), Some(folder_str.as_str()));
    }

    #[test]
    fn load_or_migrate_defaults_on_fresh_install() {
        let dir = tempdir().unwrap();
        let cfg = load_or_migrate(dir.path());
        assert_eq!(cfg.folder, None);
        assert_eq!(cfg.settings.theme, "auto");
        assert_eq!(cfg.settings.sort_order, "priority");
        assert_eq!(cfg.settings.upcoming_days, 14);
    }

    #[test]
    fn existing_config_json_is_trusted_over_legacy_sources() {
        let dir = tempdir().unwrap();
        // A real config.json must win, ignoring legacy file and tasks.json.
        std::fs::write(
            dir.path().join(CONFIG_FILE),
            r#"{"folder":null,"settings":{"theme":"light","sort_order":"priority","upcoming_days":7}}"#,
        )
        .unwrap();
        std::fs::write(dir.path().join(LEGACY_FILE), r#"{"folder":"/somewhere"}"#).unwrap();
        std::fs::write(
            dir.path().join(DATA_FILE),
            r#"{"tasks":[],"tags":[],"settings":{"theme":"dark"}}"#,
        )
        .unwrap();

        let cfg = load_or_migrate(dir.path());
        assert_eq!(cfg.folder, None);
        assert_eq!(cfg.settings.theme, "light");
        assert_eq!(cfg.settings.upcoming_days, 7);
    }

    #[test]
    fn update_settings_persists_to_disk() {
        let dir = tempdir().unwrap();
        let state = ConfigState::new(dir.path(), Config::default());
        state
            .update_settings(|s| {
                s.theme = "dark".into();
                Ok(())
            })
            .unwrap();
        assert_eq!(state.settings().theme, "dark");

        // Persisted, not just in memory.
        let bytes = std::fs::read(config_path(dir.path())).unwrap();
        let on_disk: Config = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(on_disk.settings.theme, "dark");
    }

    #[test]
    fn set_folder_persists_and_preserves_settings() {
        let dir = tempdir().unwrap();
        let mut initial = Config::default();
        initial.settings.theme = "dark".into();
        let state = ConfigState::new(dir.path(), initial);

        state.set_folder(Some("/data/sync".into())).unwrap();
        assert_eq!(state.folder().as_deref(), Some("/data/sync"));

        let bytes = std::fs::read(config_path(dir.path())).unwrap();
        let on_disk: Config = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(on_disk.folder.as_deref(), Some("/data/sync"));
        // Folder change must not clobber settings.
        assert_eq!(on_disk.settings.theme, "dark");
    }
}
