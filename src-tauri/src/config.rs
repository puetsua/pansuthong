//! Device-local configuration: the user's chosen data-file folder plus all
//! app settings (theme, sort order, Upcoming horizon, new-tag defaults).
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
    /// "auto" | "light" | "dark". `#[serde(default)]` so a partial settings
    /// object missing this key still loads (defaulting only `theme`) instead of
    /// failing the whole parse and discarding sort_order/upcoming_days.
    #[serde(default = "default_theme")]
    pub theme: String,
    /// Task list ordering: "priority" (weight desc, then date) or "date".
    #[serde(default = "default_sort_order")]
    pub sort_order: String,
    /// How many days ahead the Upcoming view looks. The UI bounds it to 1..=365.
    #[serde(default = "default_upcoming_days")]
    pub upcoming_days: u32,
    /// Color pre-filled when creating a new tag (#79). A hex string like
    /// "#475569". `#[serde(default)]` so older config.json files still load.
    #[serde(default = "default_tag_color")]
    pub default_tag_color: String,
    /// Priority weight pre-filled when creating a new tag (#79). The UI bounds it
    /// to the same -9999..=9999 range a tag weight may take; defaults to 0.
    #[serde(default)]
    pub default_tag_priority: i64,
}

fn default_theme() -> String {
    "auto".into()
}

fn default_sort_order() -> String {
    "priority".into()
}

fn default_upcoming_days() -> u32 {
    14
}

fn default_tag_color() -> String {
    "#475569".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "auto".into(),
            sort_order: default_sort_order(),
            upcoming_days: default_upcoming_days(),
            default_tag_color: default_tag_color(),
            default_tag_priority: 0,
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
    // Atomic temp+rename (shared with the data store) so a crash mid-write can't
    // leave a truncated config.json — which load_or_migrate would treat as
    // absent and silently re-migrate, resetting settings to defaults.
    crate::store::atomic_write(path, &bytes)
}

/// Load `config.json`, or migrate to it on first launch after the rename.
///
/// Migration (only when `config.json` is absent):
/// 1. carry the chosen folder forward from a legacy `data_location.json`, and
/// 2. lift the `settings` object out of the existing `tasks.json` so each
///    device keeps the theme/sort/horizon it had before settings became
///    device-local.
///
/// The migrated config is written to `config.json`; the legacy file is left in
/// place (harmless) so a downgrade still finds it.
pub fn load_or_migrate(default_dir: &Path) -> Config {
    if let Ok(bytes) = std::fs::read(config_path(default_dir)) {
        if let Ok(cfg) = serde_json::from_slice::<Config>(&bytes) {
            return cfg;
        }
    }
    let folder = read_legacy_folder(default_dir);
    // If a custom folder is configured but not currently mounted (cloud-sync
    // not yet synced, removable/network drive offline), the real settings live
    // in its tasks.json, which we can't read yet. Don't commit a config.json
    // built from the fallback default-dir file — that would lock in default
    // settings forever (migration is one-shot). Defer: use defaults this
    // session and retry the migration on the next launch.
    let folder_unavailable = matches!(&folder, Some(f) if !Path::new(f).is_dir());
    let data_path = resolve_data_path(default_dir, &folder);
    let settings = lift_settings_from_tasks(&data_path);
    let cfg = Config { folder, settings };
    if !folder_unavailable {
        if let Err(e) = persist(&config_path(default_dir), &cfg) {
            eprintln!("warning: failed to write migrated config.json: {e}");
        }
    }
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

    /// Mutate the settings, persist, and return the updated copy. The in-memory
    /// value is updated only after a successful write, so a validation error in
    /// `f` or a failed persist leaves memory and disk in agreement (no partial
    /// mutation visible to a later `settings()` read).
    pub fn update_settings<F>(&self, f: F) -> Result<Settings>
    where
        F: FnOnce(&mut Settings) -> Result<()>,
    {
        let mut g = self.inner.lock().unwrap();
        let mut next = g.settings.clone();
        f(&mut next)?;
        let candidate = Config { folder: g.folder.clone(), settings: next };
        persist(&self.path, &candidate)?;
        g.settings = candidate.settings.clone();
        Ok(g.settings.clone())
    }

    /// Set (or clear) the chosen folder and persist. Commits to memory only
    /// after the write succeeds, keeping memory and disk consistent.
    pub fn set_folder(&self, folder: Option<String>) -> Result<()> {
        let mut g = self.inner.lock().unwrap();
        let candidate = Config { folder, settings: g.settings.clone() };
        persist(&self.path, &candidate)?;
        g.folder = candidate.folder;
        Ok(())
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
    fn update_settings_rolls_back_on_validation_error() {
        let dir = tempdir().unwrap();
        let state = ConfigState::new(dir.path(), Config::default());

        // Closure mutates theme, then fails — neither memory nor disk should
        // reflect the partial mutation.
        let result = state.update_settings(|s| {
            s.theme = "dark".into();
            Err(crate::error::AppError::Invalid("bad".into()))
        });
        assert!(result.is_err());
        assert_eq!(state.settings().theme, "auto", "memory must not keep the partial mutation");

        // No config.json was written (first successful persist creates it).
        assert!(!config_path(dir.path()).exists());
    }

    #[test]
    fn load_or_migrate_defers_when_configured_folder_is_unavailable() {
        let dir = tempdir().unwrap();
        // Legacy config points at a folder that doesn't exist (e.g. cloud-sync
        // not mounted yet). Real settings live in that folder's tasks.json,
        // which we can't read — so migration must NOT be committed.
        std::fs::write(
            dir.path().join(LEGACY_FILE),
            r#"{"folder":"/no/such/folder/at/all"}"#,
        )
        .unwrap();

        let cfg = load_or_migrate(dir.path());
        // Folder is still surfaced for this session...
        assert_eq!(cfg.folder.as_deref(), Some("/no/such/folder/at/all"));
        // ...but nothing was persisted, so next launch retries the migration.
        assert!(!config_path(dir.path()).exists(), "migration must be deferred, not locked in");
    }

    #[test]
    fn settings_missing_theme_only_defaults_theme() {
        // A partial settings object lacking `theme` keeps the other fields.
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join(DATA_FILE),
            r#"{"tasks":[],"tags":[],"settings":{"sort_order":"date","upcoming_days":21}}"#,
        )
        .unwrap();

        let cfg = load_or_migrate(dir.path());
        assert_eq!(cfg.settings.theme, "auto");
        assert_eq!(cfg.settings.sort_order, "date");
        assert_eq!(cfg.settings.upcoming_days, 21);
    }

    #[test]
    fn settings_default_includes_new_tag_defaults() {
        let s = Settings::default();
        assert_eq!(s.default_tag_color, "#475569");
        assert_eq!(s.default_tag_priority, 0);
    }

    #[test]
    fn settings_missing_tag_defaults_load_with_fallbacks() {
        // An older config.json predating #79 lacks the two new keys; they must
        // default rather than fail the whole parse.
        let s: Settings =
            serde_json::from_str(r#"{"theme":"dark","sort_order":"date","upcoming_days":30}"#)
                .unwrap();
        assert_eq!(s.theme, "dark");
        assert_eq!(s.default_tag_color, "#475569");
        assert_eq!(s.default_tag_priority, 0);
    }

    #[test]
    fn settings_round_trip_preserves_tag_defaults() {
        let mut s = Settings::default();
        s.default_tag_color = "#ef4444".into();
        s.default_tag_priority = 7;
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.default_tag_color, "#ef4444");
        assert_eq!(back.default_tag_priority, 7);
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
