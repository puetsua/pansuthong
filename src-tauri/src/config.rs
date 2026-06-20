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
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

const CONFIG_FILE: &str = "config.json";
/// Pre-rename filename, migrated to `config.json` on first launch.
const LEGACY_FILE: &str = "data_location.json";
const LEGACY_DATA_FILE: &str = "tasks.json";

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
    /// Hour (0..=23) at which the logical day rolls over in the Today view. 0 =
    /// midnight (the default and prior behavior); 4 = a 4am rollover for night
    /// owls. `#[serde(default)]` so older config.json files still load.
    #[serde(default)]
    pub day_start_hour: u32,
    /// Color pre-filled when creating a new tag (#79). A hex string like
    /// "#475569". `#[serde(default)]` so older config.json files still load.
    #[serde(default = "default_tag_color")]
    pub default_tag_color: String,
    /// Priority weight pre-filled when creating a new tag (#79). The UI bounds it
    /// to the same -9999..=9999 range a tag weight may take; defaults to 0.
    #[serde(default)]
    pub default_tag_priority: i64,
    /// UI language (#26): "auto" (follow the OS locale, the default), or a
    /// supported tag like "en" / "zh-TW". `#[serde(default)]` so older
    /// config.json files predating i18n still load.
    #[serde(default = "default_language")]
    pub language: String,
    /// Play a short completion sound when a task is marked done (#80). Device-local
    /// and frontend-driven (a WebView `<audio>` through the media volume); the Rust
    /// side only persists the preference. Defaults to `true`; `#[serde(default)]`
    /// so older config.json files predating the sound still load (defaulting on).
    #[serde(default = "default_sound_on_complete")]
    pub sound_on_complete: bool,
    /// How often (in minutes) to re-notify while a running task keeps exceeding its
    /// time estimate. The UI bounds it to 1..=1440. `#[serde(default …)]` so older
    /// config.json files predating the setting still load (defaulting to 10).
    #[serde(default = "default_reminder_interval_minutes")]
    pub reminder_interval_minutes: u32,
    /// Largest attachment (in MiB) the user may add. Device-local; attachments
    /// are copied into the data folder and mirrored to the sync folder, so a big
    /// file bloats every device's synced copy — hence a configurable cap, with a
    /// UI warning. The UI bounds it to 1..=10240 (10 GiB). `#[serde(default …)]`
    /// so older config.json files predating the setting still load (1 GiB).
    #[serde(default = "default_max_attachment_mb")]
    pub max_attachment_mb: u32,
    /// How many days back the Recurrence dashboard's heatmap reaches by default
    /// (ending today). Device-local; the UI bounds it to 7..=365 and defaults to
    /// 90. `#[serde(default …)]` so older config.json files predating the setting
    /// still load (90 days).
    #[serde(default = "default_recurrence_heatmap_days")]
    pub recurrence_heatmap_days: u32,
    /// First day of the week for the Recurrence heatmap columns. 0 = Sunday ..
    /// 6 = Saturday (JS `getDay` convention). Defaults to 1 (Monday, the prior
    /// behavior). `#[serde(default …)]` so older config.json files still load.
    #[serde(default = "default_first_day_of_week")]
    pub first_day_of_week: u32,
    /// Legacy combined date-time display format preset (#date-time-format).
    /// New writes use `date_format` and `time_format`, but keeping this field
    /// lets older config.json files continue to influence the date fallback.
    #[serde(default = "default_date_time_format")]
    pub date_time_format: String,
    /// Date display format preset. `None` means fall back to `date_time_format`
    /// if present, then "locale".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date_format: Option<String>,
    /// Time display format preset. `None` means "locale".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_format: Option<String>,
    /// Active theme preset id (#15) — a built-in or a custom preset. The frontend
    /// owns the preset list and token semantics; Rust stores this opaquely. `None` =
    /// the built-in default preset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_preset: Option<String>,
    /// User-defined themes (#15), device-local. Each carries a full light + dark token
    /// map (CSS custom property name -> hex). Rust only shape-validates and stores
    /// them; the frontend resolves/renders. `None` = no custom presets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_presets: Option<Vec<ThemePreset>>,
}

/// A user-defined theme (#15). Opaque to Rust beyond shape validation: an id, a
/// display name, and per-variant token maps keyed by CSS custom property name.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemePreset {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub light: HashMap<String, String>,
    #[serde(default)]
    pub dark: HashMap<String, String>,
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

fn default_language() -> String {
    "auto".into()
}

fn default_sound_on_complete() -> bool {
    true
}

fn default_reminder_interval_minutes() -> u32 {
    10
}

fn default_max_attachment_mb() -> u32 {
    1024
}

fn default_recurrence_heatmap_days() -> u32 {
    90
}

fn default_first_day_of_week() -> u32 {
    1
}

fn default_date_time_format() -> String {
    "locale".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "auto".into(),
            sort_order: default_sort_order(),
            upcoming_days: default_upcoming_days(),
            day_start_hour: 0,
            default_tag_color: default_tag_color(),
            default_tag_priority: 0,
            language: default_language(),
            sound_on_complete: default_sound_on_complete(),
            reminder_interval_minutes: default_reminder_interval_minutes(),
            max_attachment_mb: default_max_attachment_mb(),
            recurrence_heatmap_days: default_recurrence_heatmap_days(),
            first_day_of_week: default_first_day_of_week(),
            date_time_format: default_date_time_format(),
            date_format: None,
            time_format: None,
            theme_preset: None,
            custom_presets: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    /// Absolute folder path chosen by the user; `None` = use the default dir.
    #[serde(default)]
    pub folder: Option<String>,
    /// Stable per-install id used to name this device's sync replica.
    #[serde(default = "new_device_id")]
    pub device_id: String,
    #[serde(default)]
    pub settings: Settings,
}

fn new_device_id() -> String {
    Uuid::new_v4().simple().to_string()
}

fn config_path(default_dir: &Path) -> PathBuf {
    default_dir.join(CONFIG_FILE)
}

pub fn data_file_name(device_id: &str) -> String {
    let clean: String = device_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let id = if clean.is_empty() {
        "device"
    } else {
        clean.as_str()
    };
    format!("tasks_{id}.json")
}

pub fn legacy_data_file_name() -> &'static str {
    LEGACY_DATA_FILE
}

/// Per-device attachment subdirectory: `attachments_<device>`. Attachments live
/// here (one folder per device) instead of flat beside the data file so two
/// devices syncing into the same folder never collide on a blob. Sanitized with
/// the same charset as `data_file_name` so the name is always path-safe.
pub fn attachments_dir_name(device_id: &str) -> String {
    let clean: String = device_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let id = if clean.is_empty() {
        "device"
    } else {
        clean.as_str()
    };
    format!("attachments_{id}")
}

/// Resolve this device's writable replica path: `<folder>/tasks_<device>.json`
/// if a valid folder is configured, else `<default_dir>/tasks_<device>.json`.
pub fn resolve_data_path(default_dir: &Path, folder: &Option<String>, device_id: &str) -> PathBuf {
    let file = data_file_name(device_id);
    match folder {
        Some(f) if Path::new(f).is_dir() => Path::new(f).join(file),
        _ => default_dir.join(file),
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
            if let Err(e) = persist(&config_path(default_dir), &cfg) {
                eprintln!("warning: failed to persist config.json device id: {e}");
            }
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
    let device_id = new_device_id();
    let data_path = resolve_data_path(default_dir, &folder, &device_id);
    let legacy_data_path = match &folder {
        Some(f) if Path::new(f).is_dir() => Path::new(f).join(LEGACY_DATA_FILE),
        _ => default_dir.join(LEGACY_DATA_FILE),
    };
    let settings = if data_path.exists() {
        lift_settings_from_tasks(&data_path)
    } else {
        lift_settings_from_tasks(&legacy_data_path)
    };
    let cfg = Config {
        folder,
        device_id,
        settings,
    };
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
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).settings.clone()
    }

    pub fn folder(&self) -> Option<String> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).folder.clone()
    }

    /// Mutate the settings, persist, and return the updated copy. The in-memory
    /// value is updated only after a successful write, so a validation error in
    /// `f` or a failed persist leaves memory and disk in agreement (no partial
    /// mutation visible to a later `settings()` read).
    pub fn update_settings<F>(&self, f: F) -> Result<Settings>
    where
        F: FnOnce(&mut Settings) -> Result<()>,
    {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mut next = g.settings.clone();
        f(&mut next)?;
        let candidate = Config {
            folder: g.folder.clone(),
            device_id: g.device_id.clone(),
            settings: next,
        };
        persist(&self.path, &candidate)?;
        g.settings = candidate.settings.clone();
        Ok(g.settings.clone())
    }

    /// Set (or clear) the chosen folder and persist. Commits to memory only
    /// after the write succeeds, keeping memory and disk consistent.
    pub fn set_folder(&self, folder: Option<String>) -> Result<()> {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let candidate = Config {
            folder,
            device_id: g.device_id.clone(),
            settings: g.settings.clone(),
        };
        persist(&self.path, &candidate)?;
        g.folder = candidate.folder;
        Ok(())
    }

    pub fn device_id(&self) -> String {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).device_id.clone()
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
            dir.path().join(LEGACY_DATA_FILE),
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
            format!(
                r#"{{"folder":{}}}"#,
                serde_json::to_string(&folder_str).unwrap()
            ),
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
        assert!(cfg.settings.sound_on_complete); // completion chime defaults on (#80)
        assert_eq!(cfg.settings.date_time_format, "locale"); // date-time format defaults to locale
        assert_eq!(cfg.settings.date_format, None);
        assert_eq!(cfg.settings.time_format, None);
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
            dir.path().join(LEGACY_DATA_FILE),
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
        assert_eq!(
            state.settings().theme,
            "auto",
            "memory must not keep the partial mutation"
        );

        // No config.json was written (first successful persist creates it).
        assert!(!config_path(dir.path()).exists());
    }

    #[test]
    fn config_state_recovers_after_a_panic_poisons_the_lock() {
        use std::panic::{catch_unwind, AssertUnwindSafe};

        let dir = tempdir().unwrap();
        let state = ConfigState::new(dir.path(), Config::default());

        // A panic inside the update closure unwinds while the lock is held, which
        // poisons the std Mutex. (The panic backtrace printed during this test is
        // expected, not a failure.)
        let poisoned = catch_unwind(AssertUnwindSafe(|| {
            let _ = state.update_settings(|_| -> Result<()> { panic!("boom") });
        }));
        assert!(poisoned.is_err(), "the closure should have panicked");

        // Before the fix, every later lock().unwrap() would re-panic on the poison.
        // With unwrap_or_else(|e| e.into_inner()) the guard is recovered, so reads
        // and writes keep working.
        let _ = state.settings();
        state
            .update_settings(|s| {
                s.theme = "dark".into();
                Ok(())
            })
            .unwrap();
        assert_eq!(state.settings().theme, "dark");
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
        assert!(
            !config_path(dir.path()).exists(),
            "migration must be deferred, not locked in"
        );
    }

    #[test]
    fn settings_missing_theme_only_defaults_theme() {
        // A partial settings object lacking `theme` keeps the other fields.
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join(LEGACY_DATA_FILE),
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
        // A config.json predating the day-start-hour setting defaults to midnight (0).
        assert_eq!(s.day_start_hour, 0);
        // A config.json predating the reminder-interval setting defaults to 10 minutes.
        assert_eq!(s.reminder_interval_minutes, 10);
    }

    #[test]
    fn settings_round_trip_preserves_day_start_hour() {
        let mut s = Settings::default();
        s.day_start_hour = 4;
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.day_start_hour, 4);
    }

    #[test]
    fn settings_round_trip_preserves_reminder_interval() {
        let mut s = Settings::default();
        s.reminder_interval_minutes = 30;
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.reminder_interval_minutes, 30);
    }

    #[test]
    fn settings_missing_recurrence_heatmap_days_defaults_to_90() {
        // A config.json predating the heatmap range setting lacks the key; it
        // must default to 90 rather than fail the whole parse.
        let s: Settings =
            serde_json::from_str(r#"{"theme":"dark","sort_order":"date","upcoming_days":30}"#)
                .unwrap();
        assert_eq!(s.recurrence_heatmap_days, 90);
    }

    #[test]
    fn settings_round_trip_preserves_recurrence_heatmap_days() {
        let mut s = Settings::default();
        s.recurrence_heatmap_days = 180;
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.recurrence_heatmap_days, 180);
    }

    #[test]
    fn settings_missing_first_day_of_week_defaults_to_monday() {
        // A config.json predating the setting lacks the key; it must default to 1
        // (Monday, the prior heatmap behavior) rather than fail the parse.
        let s: Settings =
            serde_json::from_str(r#"{"theme":"dark","sort_order":"date","upcoming_days":30}"#)
                .unwrap();
        assert_eq!(s.first_day_of_week, 1);
    }

    #[test]
    fn settings_round_trip_preserves_first_day_of_week() {
        let mut s = Settings::default();
        s.first_day_of_week = 0; // Sunday
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.first_day_of_week, 0);
    }

    #[test]
    fn settings_missing_language_defaults_to_auto() {
        // A config.json predating i18n (#26) lacks `language`; it must default
        // to "auto" rather than fail the whole parse.
        let s: Settings =
            serde_json::from_str(r#"{"theme":"dark","sort_order":"date","upcoming_days":30}"#)
                .unwrap();
        assert_eq!(s.language, "auto");
    }

    #[test]
    fn settings_round_trip_preserves_language() {
        let mut s = Settings::default();
        s.language = "zh-TW".into();
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.language, "zh-TW");
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
    fn settings_missing_date_time_format_defaults_to_locale() {
        // A config.json predating date-time format selection lacks the key;
        // it must default to "locale" rather than fail the whole parse.
        let s: Settings =
            serde_json::from_str(r#"{"theme":"dark","sort_order":"date","upcoming_days":30}"#)
                .unwrap();
        assert_eq!(s.date_time_format, "locale");
    }

    #[test]
    fn settings_round_trip_preserves_date_time_format() {
        let mut s = Settings::default();
        s.date_time_format = "japanese".into();
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.date_time_format, "japanese");
    }

    #[test]
    fn settings_round_trip_preserves_date_and_time_formats() {
        let mut s = Settings::default();
        s.date_format = Some("roc".into());
        s.time_format = Some("twenty_four".into());
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.date_format.as_deref(), Some("roc"));
        assert_eq!(back.time_format.as_deref(), Some("twenty_four"));
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
