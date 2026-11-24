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
    /// Play a short completion sound when a task is marked done (#80). Device-local;
    /// Linux desktop plays via a native command (#242), other platforms use WebView
    /// `<audio>` through the media volume. The Rust
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
    /// How many days back the Dashboard heatmap reaches by default
    /// (ending today). Device-local; the UI bounds it to 7..=365 and defaults to
    /// 90. Field name `recurrence_heatmap_days` is kept for config.json
    /// compatibility. `#[serde(default …)]` so older config.json files predating
    /// the setting still load (90 days).
    #[serde(default = "default_recurrence_heatmap_days")]
    pub recurrence_heatmap_days: u32,
    /// First day of the week for Dashboard/Tag heatmap columns. 0 = Sunday ..
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
    /// Built-in MCP server (#246). Device-local; never synced.
    #[serde(default)]
    pub mcp_enabled: bool,
    /// TCP port for the local MCP HTTP endpoint (1024..=65535).
    #[serde(default = "default_mcp_port")]
    pub mcp_port: u32,
    /// Desktop (#252): closing the main window hides it to the tray instead of
    /// quitting. On by default so reminders keep firing; ignored without a tray.
    #[serde(default = "default_close_to_tray")]
    pub close_to_tray: bool,
    /// Desktop (#252): start hidden in the tray when the user signs in. The OS
    /// login entry is written/removed alongside this flag.
    #[serde(default)]
    pub launch_at_login: bool,
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
    1
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

pub const MCP_PORT_DEFAULT: u32 = 7373;

fn default_mcp_port() -> u32 {
    MCP_PORT_DEFAULT
}

fn default_close_to_tray() -> bool {
    true
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
            mcp_enabled: false,
            mcp_port: default_mcp_port(),
            close_to_tray: default_close_to_tray(),
            launch_at_login: false,
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
    format!("tasks_{}.db", sanitize_device_id(device_id))
}

/// Extract the device id embedded in a replica filename (`tasks_<id>.db` / `.json`).
pub fn device_id_from_data_path(data_path: &Path) -> Option<String> {
    data_path.file_name().and_then(|name| name.to_str()).and_then(|name| {
        name.strip_prefix("tasks_").and_then(|rest| {
            rest.strip_suffix(".db")
                .or_else(|| rest.strip_suffix(".json"))
                .map(|id| id.to_string())
        })
    })
}

/// Sanitize a device id the same way replica filenames do.
pub fn sanitize_device_id(device_id: &str) -> String {
    let clean: String = device_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if clean.is_empty() {
        "device".into()
    } else {
        clean
    }
}

fn non_empty_trimmed(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(target_os = "android")]
fn title_case_word(value: &str) -> String {
    let mut out = value.to_string();
    if let Some(first) = out.get_mut(0..1) {
        first.make_ascii_uppercase();
    }
    out
}

/// Build a readable Android device label from `getprop`-style keys.
/// Injectable getter keeps the parsing separate from the Android property API.
#[cfg(target_os = "android")]
pub(crate) fn android_device_label_from_properties(
    get: impl Fn(&str) -> Option<String>,
) -> Option<String> {
    if let Some(name) = get("ro.product.marketname").and_then(non_empty_trimmed) {
        return Some(name);
    }

    let manufacturer = get("ro.product.manufacturer").and_then(non_empty_trimmed);
    let model = get("ro.product.model").and_then(non_empty_trimmed);

    match (manufacturer, model) {
        (Some(mfr), Some(model)) => {
            if model.to_ascii_lowercase().contains(&mfr.to_ascii_lowercase()) {
                Some(model)
            } else {
                Some(format!("{} {}", title_case_word(&mfr), model))
            }
        }
        (_, Some(model)) => Some(model),
        (Some(mfr), None) => Some(title_case_word(&mfr)),
        (None, None) => None,
    }
}

#[cfg(target_os = "android")]
fn android_device_label() -> Option<String> {
    use android_system_properties::AndroidSystemProperties;
    let props = AndroidSystemProperties::new();
    android_device_label_from_properties(|key| props.get(key))
}

#[cfg(not(target_os = "android"))]
fn android_device_label() -> Option<String> {
    None
}

fn hostname_from_env() -> Option<String> {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .and_then(non_empty_trimmed)
}

/// Readable device label for history. Desktop: `COMPUTERNAME` / `HOSTNAME`;
/// Android: marketing name or manufacturer+model from system properties; else
/// sanitized device id.
pub fn resolve_device_name(device_id: &str) -> String {
    hostname_from_env()
        .or_else(android_device_label)
        .unwrap_or_else(|| sanitize_device_id(device_id))
}

pub fn legacy_data_file_name() -> &'static str {
    LEGACY_DATA_FILE
}

/// Per-device attachment subdirectory: `attachments_<device>`. Attachments live
/// here (one folder per device) instead of flat beside the data file so two
/// devices syncing into the same folder never collide on a blob. Sanitized with
/// the same charset as `data_file_name` so the name is always path-safe.
pub fn attachments_dir_name(device_id: &str) -> String {
    format!("attachments_{}", sanitize_device_id(device_id))
}

/// Resolve this device's writable replica path: `<folder>/tasks_<device>.db`
/// if a valid folder is configured, else `<default_dir>/tasks_<device>.db`.
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
    crate::store::atomic_write(path, &bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
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
