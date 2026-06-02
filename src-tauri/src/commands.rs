use crate::config::{ConfigState, Settings};
use crate::conflict::{apply_decisions, diff_tasks, tags_to_merge, Decision, TaskDiff};
use crate::error::{AppError, Result};
use crate::model::{new_tag_id, new_task_id, now_ms, Tag, Task, TemplateTask};
use crate::store::AppState;
use crate::sync::scan_conflict_files;
use chrono::NaiveDate;
use serde::{Deserialize, Deserializer, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};

const STORE_CHANGED: &str = "store-changed";

fn emit_changed(app: &AppHandle) {
    let _ = app.emit(STORE_CHANGED, ());
}

/// Wire shape the frontend consumes: the synced document (tasks + tags) with the
/// device-local `settings` spliced in. Settings live in `config.json`, not the
/// synced `Document`, but the UI still receives them in one payload.
#[derive(Serialize)]
pub struct DocumentView {
    version: u32,
    // ISO-8601 local time with offset (second precision), consistent with the
    // on-disk file and the frontend's string-typed `last_modified`. Omitted when 0
    // (never edited), so the UI shows an em dash instead of a 1970 date.
    #[serde(skip_serializing_if = "crate::model::is_zero", serialize_with = "crate::model::iso_secs::serialize")]
    last_modified: i64,
    settings: Settings,
    tags: Vec<Tag>,
    tasks: Vec<Task>,
    template_tasks: Vec<TemplateTask>,
}

fn document_view(state: &AppState, config: &ConfigState) -> DocumentView {
    state.read(|d| DocumentView {
        version: d.version,
        last_modified: d.last_modified,
        settings: config.settings(),
        tags: d.tags.clone(),
        tasks: d.tasks.clone(),
        template_tasks: d.template_tasks.clone(),
    })
}

#[tauri::command]
pub fn get_document(state: State<'_, AppState>, config: State<'_, ConfigState>) -> DocumentView {
    document_view(&state, &config)
}

/// Manual "Sync now": re-read the data file from disk immediately instead of
/// waiting for the polling fallback. Picks up changes a cloud-sync client
/// (Google Drive) pulled in from another device. Returns the freshest document.
#[tauri::command]
pub fn sync_now(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    app: AppHandle,
) -> DocumentView {
    let path = state.path();
    if crate::sync::reload_if_changed(&state, &path) {
        emit_changed(&app);
    }
    document_view(&state, &config)
}

#[derive(Deserialize)]
pub struct NewTaskInput {
    pub title: String,
    #[serde(default)] pub due_date: Option<NaiveDate>,
    #[serde(default)] pub due_time: Option<String>,
    #[serde(default)] pub start_date: Option<NaiveDate>,
    #[serde(default)] pub start_time: Option<String>,
    #[serde(default)] pub notes: String,
    #[serde(default)] pub tag_ids: Vec<String>,
}

/// Reject a time-of-day that isn't a valid "HH:MM" (#93). `None` (all-day) is
/// always fine. Keeps malformed times from ever reaching tasks.json.
fn validate_time(t: Option<&str>) -> Result<()> {
    if let Some(s) = t {
        chrono::NaiveTime::parse_from_str(s, "%H:%M")
            .map_err(|_| AppError::Invalid(format!("time must be HH:MM, got {s:?}")))?;
    }
    Ok(())
}

/// Drop tag ids that don't exist in the document so tasks never persist dangling
/// tag references (which silently behave as untagged, landing in Inbox at
/// priority 0) (#40).
fn retain_known_tags(ids: Vec<String>, tags: &[Tag]) -> Vec<String> {
    ids.into_iter().filter(|id| tags.iter().any(|t| &t.id == id)).collect()
}

/// Upper bound for a template's relative date offset (#71). 0 = today; the editor
/// caps entry to this range too.
const OFFSET_DAYS_MAX: i64 = 3650;

/// Reject a template offset outside `0..=OFFSET_DAYS_MAX` so a bad value never
/// persists (and so instantiation's date arithmetic always stays in range).
fn validate_offset_days(days: Option<i64>) -> Result<()> {
    if let Some(n) = days {
        if !(0..=OFFSET_DAYS_MAX).contains(&n) {
            return Err(AppError::Invalid(format!(
                "offset days must be 0..={OFFSET_DAYS_MAX}, got {n}"
            )));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn add_task(input: NewTaskInput, state: State<'_, AppState>, app: AppHandle) -> Result<Task> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid("title is empty".into()));
    }
    validate_time(input.due_time.as_deref())?;
    validate_time(input.start_time.as_deref())?;
    let ts = now_ms();
    let saved = state.write(|d| {
        let task = Task {
            id: new_task_id(),
            title,
            due_date: input.due_date,
            // A time without its date is meaningless; drop it (all-day).
            due_time:       input.due_date.and(input.due_time),
            start_date: input.start_date,
            start_time: input.start_date.and(input.start_time),
            notes: input.notes,
            tag_ids: retain_known_tags(input.tag_ids, &d.tags),
            created_at: ts,
            completed_at: None,
            updated_at: ts,
        };
        d.tasks.push(task.clone());
        Ok(task)
    })?;
    emit_changed(&app);
    Ok(saved)
}

/// Lets an optional field distinguish "absent" from an explicit JSON `null`.
/// With `#[serde(default, deserialize_with = "double_option")]`:
///   absent -> None (leave unchanged); null -> Some(None) (clear); value -> Some(Some(v)) (set).
fn double_option<'de, T, D>(de: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(de).map(Some)
}

// `due_date` and `start_date` are `Option<Option<_>>` decoded with the
// `double_option` deserializer above, so the edit UI can distinguish "field absent
// (don't change)" from "field is null (clear it)".
#[derive(Deserialize)]
pub struct UpdateTaskInput {
    pub id: String,
    #[serde(default)] pub title: Option<String>,
    #[serde(default, deserialize_with = "double_option")] pub due_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")] pub due_time: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")] pub start_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")] pub start_time: Option<Option<String>>,
    #[serde(default)] pub notes: Option<String>,
    #[serde(default)] pub tag_ids: Option<Vec<String>>,
}

#[tauri::command]
pub fn update_task(input: UpdateTaskInput, state: State<'_, AppState>, app: AppHandle) -> Result<Task> {
    let updated = state.write(|d| {
        // Snapshot known tag ids before the mutable task borrow so dangling
        // references can be stripped (#40).
        let known: std::collections::HashSet<String> =
            d.tags.iter().map(|t| t.id.clone()).collect();
        let t = d.tasks.iter_mut().find(|t| t.id == input.id)
            .ok_or_else(|| AppError::NotFound(format!("task {}", input.id)))?;
        if let Some(v) = input.title {
            let trimmed = v.trim().to_string();
            if trimmed.is_empty() {
                return Err(AppError::Invalid("title is empty".into()));
            }
            t.title = trimmed;
        }
        if let Some(ref v) = input.due_time       { validate_time(v.as_deref())?; }
        if let Some(ref v) = input.start_time { validate_time(v.as_deref())?; }
        if let Some(v) = input.due_date       { t.due_date = v; }
        if let Some(v) = input.due_time       { t.due_time = v; }
        if let Some(v) = input.start_date { t.start_date = v; }
        if let Some(v) = input.start_time { t.start_time = v; }
        if let Some(v) = input.notes          { t.notes = v; }
        if let Some(v) = input.tag_ids        {
            t.tag_ids = v.into_iter().filter(|id| known.contains(id)).collect();
        }
        // A time without its date is meaningless; clearing a date drops its time.
        if t.due_date.is_none()       { t.due_time = None; }
        if t.start_date.is_none() { t.start_time = None; }
        t.updated_at = now_ms();
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

/// Toggle a task's completion. Finishing a task also archives it (sending it out
/// of the active views); reopening it restores the task. See `Task::set_done`.
#[tauri::command]
pub fn set_task_done(id: String, done: bool, state: State<'_, AppState>, app: AppHandle) -> Result<Task> {
    let updated = state.write(|d| {
        let t = d.tasks.iter_mut().find(|t| t.id == id)
            .ok_or_else(|| AppError::NotFound(format!("task {id}")))?;
        t.set_done(done, now_ms());
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

#[tauri::command]
pub fn delete_task(id: String, state: State<'_, AppState>, app: AppHandle) -> Result<()> {
    state.write(|d| {
        let before = d.tasks.len();
        d.tasks.retain(|t| t.id != id);
        if d.tasks.len() == before {
            return Err(AppError::NotFound(format!("task {id}")));
        }
        Ok(())
    })?;
    emit_changed(&app);
    Ok(())
}

// ───────────────────────────── Templates (#71) ─────────────────────────────
// Reusable blueprints live in their own `template_tasks` list. They carry relative
// date offsets (resolved to absolute dates when a task is spawned, client-side via
// add_task) rather than completion or absolute dates.

#[derive(Deserialize)]
pub struct NewTemplateInput {
    pub title: String,
    #[serde(default)] pub notes: String,
    #[serde(default)] pub tag_ids: Vec<String>,
    #[serde(default)] pub due_offset_days: Option<i64>,
    #[serde(default)] pub start_offset_days: Option<i64>,
}

#[tauri::command]
pub fn add_template(input: NewTemplateInput, state: State<'_, AppState>, app: AppHandle) -> Result<TemplateTask> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid("title is empty".into()));
    }
    validate_offset_days(input.due_offset_days)?;
    validate_offset_days(input.start_offset_days)?;
    let ts = now_ms();
    let saved = state.write(|d| {
        let tmpl = TemplateTask {
            id: new_task_id(),
            title,
            notes: input.notes,
            tag_ids: retain_known_tags(input.tag_ids, &d.tags),
            created_at: ts,
            updated_at: ts,
            due_offset_days: input.due_offset_days,
            start_offset_days: input.start_offset_days,
        };
        d.template_tasks.push(tmpl.clone());
        Ok(tmpl)
    })?;
    emit_changed(&app);
    Ok(saved)
}

#[derive(Deserialize)]
pub struct UpdateTemplateInput {
    pub id: String,
    #[serde(default)] pub title: Option<String>,
    #[serde(default)] pub notes: Option<String>,
    #[serde(default)] pub tag_ids: Option<Vec<String>>,
    #[serde(default, deserialize_with = "double_option")] pub due_offset_days: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")] pub start_offset_days: Option<Option<i64>>,
}

#[tauri::command]
pub fn update_template(input: UpdateTemplateInput, state: State<'_, AppState>, app: AppHandle) -> Result<TemplateTask> {
    let updated = state.write(|d| {
        let known: std::collections::HashSet<String> =
            d.tags.iter().map(|t| t.id.clone()).collect();
        let t = d.template_tasks.iter_mut().find(|t| t.id == input.id)
            .ok_or_else(|| AppError::NotFound(format!("template {}", input.id)))?;
        if let Some(v) = input.title {
            let trimmed = v.trim().to_string();
            if trimmed.is_empty() {
                return Err(AppError::Invalid("title is empty".into()));
            }
            t.title = trimmed;
        }
        if let Some(v) = input.notes   { t.notes = v; }
        if let Some(v) = input.tag_ids {
            t.tag_ids = v.into_iter().filter(|id| known.contains(id)).collect();
        }
        if let Some(v) = input.due_offset_days       { validate_offset_days(v)?; t.due_offset_days = v; }
        if let Some(v) = input.start_offset_days { validate_offset_days(v)?; t.start_offset_days = v; }
        t.updated_at = now_ms();
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

#[tauri::command]
pub fn delete_template(id: String, state: State<'_, AppState>, app: AppHandle) -> Result<()> {
    state.write(|d| {
        let before = d.template_tasks.len();
        d.template_tasks.retain(|t| t.id != id);
        if d.template_tasks.len() == before {
            return Err(AppError::NotFound(format!("template {id}")));
        }
        Ok(())
    })?;
    emit_changed(&app);
    Ok(())
}

#[derive(Deserialize)]
pub struct NewTagInput {
    pub name: String,
    pub color: String,
    #[serde(default)] pub priority: i64,
    #[serde(default)] pub pinned: bool,
}

#[tauri::command]
pub fn add_tag(input: NewTagInput, state: State<'_, AppState>, app: AppHandle) -> Result<Tag> {
    let t = Tag { id: new_tag_id(), name: input.name, color: input.color, priority: input.priority, pinned: input.pinned };
    let saved = state.write(|d| { d.tags.push(t.clone()); Ok(t) })?;
    emit_changed(&app);
    Ok(saved)
}

#[tauri::command]
pub fn delete_tag(id: String, state: State<'_, AppState>, app: AppHandle) -> Result<()> {
    state.write(|d| {
        let before = d.tags.len();
        d.tags.retain(|t| t.id != id);
        if d.tags.len() == before {
            return Err(AppError::NotFound(format!("tag {id}")));
        }
        for task in d.tasks.iter_mut() {
            task.tag_ids.retain(|tid| tid != &id);
        }
        for tmpl in d.template_tasks.iter_mut() {
            tmpl.tag_ids.retain(|tid| tid != &id);
        }
        Ok(())
    })?;
    emit_changed(&app);
    Ok(())
}

#[derive(Deserialize)]
pub struct UpdateTagInput {
    pub id:    String,
    #[serde(default)] pub name:     Option<String>,
    #[serde(default)] pub color:    Option<String>,
    #[serde(default)] pub priority: Option<i64>,
    #[serde(default)] pub pinned:   Option<bool>,
}

#[tauri::command]
pub fn update_tag(input: UpdateTagInput, state: State<'_, AppState>, app: AppHandle) -> Result<crate::model::Tag> {
    let updated = state.write(|d| {
        let t = d.tags.iter_mut().find(|t| t.id == input.id)
            .ok_or_else(|| AppError::NotFound(format!("tag {}", input.id)))?;
        if let Some(v) = input.name {
            let trimmed = v.trim().to_string();
            if trimmed.is_empty() { return Err(AppError::Invalid("name is empty".into())); }
            t.name = trimmed;
        }
        if let Some(v) = input.color    { t.color = v; }
        if let Some(v) = input.priority { t.priority = v; }
        if let Some(v) = input.pinned   { t.pinned = v; }
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

/// Bounds for the configurable Upcoming horizon (#25).
const UPCOMING_DAYS_MIN: u32 = 1;
const UPCOMING_DAYS_MAX: u32 = 365;
const DAY_START_HOUR_MAX: u32 = 23;

/// Bounds for a tag priority weight, mirrored by the configurable default (#79).
const TAG_WEIGHT_MIN: i64 = -9999;
const TAG_WEIGHT_MAX: i64 = 9999;

/// True for a `#rgb` or `#rrggbb` hex color string. Guards the configurable
/// default tag color (#79) so a malformed value can't be stored and then
/// pre-filled into every new tag's swatch.
fn is_hex_color(s: &str) -> bool {
    let Some(hex) = s.strip_prefix('#') else { return false };
    (hex.len() == 3 || hex.len() == 6) && hex.bytes().all(|b| b.is_ascii_hexdigit())
}

#[derive(Deserialize)]
pub struct UpdateSettingsInput {
    #[serde(default)] pub theme: Option<String>,
    #[serde(default)] pub sort_order: Option<String>,
    #[serde(default)] pub upcoming_days: Option<u32>,
    #[serde(default)] pub day_start_hour: Option<u32>,
    #[serde(default)] pub default_tag_color: Option<String>,
    #[serde(default)] pub default_tag_priority: Option<i64>,
}

#[tauri::command]
pub fn update_settings(
    input: UpdateSettingsInput,
    config: State<'_, ConfigState>,
    app: AppHandle,
) -> Result<()> {
    config.update_settings(|s| {
        if let Some(t) = input.theme {
            if !matches!(t.as_str(), "auto" | "light" | "dark") {
                return Err(AppError::Invalid(format!("invalid theme: {t}")));
            }
            s.theme = t;
        }
        if let Some(order) = input.sort_order {
            if !matches!(order.as_str(), "priority" | "date") {
                return Err(AppError::Invalid(format!("invalid sort_order: {order}")));
            }
            s.sort_order = order;
        }
        if let Some(n) = input.upcoming_days {
            if !(UPCOMING_DAYS_MIN..=UPCOMING_DAYS_MAX).contains(&n) {
                return Err(AppError::Invalid(format!(
                    "upcoming_days must be {UPCOMING_DAYS_MIN}..={UPCOMING_DAYS_MAX}, got {n}"
                )));
            }
            s.upcoming_days = n;
        }
        if let Some(h) = input.day_start_hour {
            if h > DAY_START_HOUR_MAX {
                return Err(AppError::Invalid(format!(
                    "day_start_hour must be 0..={DAY_START_HOUR_MAX}, got {h}"
                )));
            }
            s.day_start_hour = h;
        }
        if let Some(color) = input.default_tag_color {
            if !is_hex_color(&color) {
                return Err(AppError::Invalid(format!("invalid default_tag_color: {color}")));
            }
            s.default_tag_color = color;
        }
        if let Some(p) = input.default_tag_priority {
            if !(TAG_WEIGHT_MIN..=TAG_WEIGHT_MAX).contains(&p) {
                return Err(AppError::Invalid(format!(
                    "default_tag_priority must be {TAG_WEIGHT_MIN}..={TAG_WEIGHT_MAX}, got {p}"
                )));
            }
            s.default_tag_priority = p;
        }
        Ok(())
    })?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn list_conflicts(state: State<'_, AppState>) -> Vec<String> {
    let path = state.path();
    scan_conflict_files(&path)
}

/// Reject any conflict path the UI didn't get from `list_conflicts`. A valid path
/// must live directly in the data dir (same parent as the data file) and match the
/// conflict-file naming pattern `scan_conflict_files` recognizes (see sync.rs).
/// Without this, these commands would `std::fs::read` / `remove_file` an arbitrary
/// caller-supplied path; a frontend bug could then touch an unrelated file (#49).
fn validate_conflict_path(candidate: &str, data_path: &Path) -> Result<PathBuf> {
    let candidate = Path::new(candidate);
    let data_dir = data_path
        .parent()
        .ok_or_else(|| AppError::Invalid("data path has no parent".into()))?;
    // Parent must be the data dir. Plain PathBuf equality, not canonicalize:
    // legitimate paths are echoed verbatim from list_conflicts, and a `..`/other-dir
    // path simply won't match (fail-safe) — canonicalize would also break on a
    // stale entry and add a Windows `\\?\` prefix mismatch.
    match candidate.parent() {
        Some(p) if p == data_dir => {}
        _ => return Err(AppError::Invalid("conflict path is not in the data directory".into())),
    }
    let name = candidate
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Invalid("conflict path has no file name".into()))?;
    let stem = data_path.file_stem().and_then(|s| s.to_str()).unwrap_or("tasks");
    let data_file_name = data_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !crate::sync::is_conflict_file_name(name, stem, data_file_name) {
        return Err(AppError::Invalid("not a recognized conflict file".into()));
    }
    Ok(candidate.to_path_buf())
}

#[tauri::command]
pub fn read_conflict(conflict_path: String, state: State<'_, AppState>) -> Result<Vec<TaskDiff>> {
    let path = validate_conflict_path(&conflict_path, &state.path())?;
    let bytes = std::fs::read(&path)?;
    let theirs: crate::model::Document = serde_json::from_slice(&bytes)?;
    let diffs = state.read(|d| diff_tasks(d, &theirs));
    Ok(diffs)
}

#[derive(Deserialize)]
pub struct ResolveConflictInput {
    pub conflict_path: String,
    pub decisions: Vec<Decision>,
}

#[tauri::command]
pub fn resolve_conflict(
    input: ResolveConflictInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<()> {
    let path = validate_conflict_path(&input.conflict_path, &state.path())?;
    let bytes = std::fs::read(&path)?;
    let theirs: crate::model::Document = serde_json::from_slice(&bytes)?;
    state.write(|d| {
        let new_tasks = apply_decisions(d, &theirs, &input.decisions);
        // Keep tags referenced by merged-in tasks so they don't dangle (#30).
        let added_tags = tags_to_merge(&new_tasks, d, &theirs);
        d.tasks = new_tasks;
        d.tags.extend(added_tags);
        Ok(())
    })?;
    let _ = std::fs::remove_file(&path);
    // Also remove the conflict copy from the synced SAF folder so it doesn't
    // re-appear on the next pull (#Phase 4B). Use the validated `path`, not the
    // raw input, so the SAF delete honors the same confinement as the local one (#49).
    #[cfg(target_os = "android")]
    saf_delete_conflict(&app, &path);
    emit_changed(&app);
    let data_path: PathBuf = state.path();
    let _ = app.emit("conflicts-detected", &scan_conflict_files(&data_path));
    Ok(())
}

#[tauri::command]
pub fn dismiss_conflict(conflict_path: String, app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    let path = validate_conflict_path(&conflict_path, &state.path())?;
    let _ = std::fs::remove_file(&path);
    // Mirror the deletion into the synced SAF folder, using the validated path (#49).
    #[cfg(target_os = "android")]
    saf_delete_conflict(&app, &path);
    let data_path: PathBuf = state.path();
    let _ = app.emit("conflicts-detected", &scan_conflict_files(&data_path));
    Ok(())
}

#[derive(serde::Serialize)]
pub struct DataLocation {
    /// User-chosen folder, or null when using the default app-data dir.
    pub folder: Option<String>,
    /// The effective absolute tasks.json path in use right now.
    pub effective_path: String,
}

fn default_data_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Invalid(format!("app_data_dir: {e}")))
}

fn data_location(state: &AppState, config: &ConfigState) -> DataLocation {
    DataLocation {
        folder: config.folder(),
        effective_path: state.path().to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn get_data_location(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
) -> DataLocation {
    data_location(&state, &config)
}

#[tauri::command]
pub fn set_data_folder(
    folder: String,
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    watcher: State<'_, crate::sync::WatcherHandle>,
    app: AppHandle,
) -> Result<DataLocation> {
    let folder_path = PathBuf::from(&folder);
    if !folder_path.is_dir() {
        return Err(AppError::Invalid(format!("not a folder: {folder}")));
    }
    let new_path = folder_path.join("tasks.json");
    state.repoint(new_path.clone())?;
    config.set_folder(Some(folder))?;
    crate::sync::restart(&watcher, &app, new_path);
    emit_changed(&app);
    let _ = app.emit("conflicts-detected", &crate::sync::scan_conflict_files(&state.path()));
    Ok(data_location(&state, &config))
}

#[tauri::command]
pub fn clear_data_folder(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    watcher: State<'_, crate::sync::WatcherHandle>,
    app: AppHandle,
) -> Result<DataLocation> {
    let default_dir = default_data_dir(&app)?;
    let new_path = default_dir.join("tasks.json");
    state.repoint(new_path.clone())?;
    config.set_folder(None)?;
    crate::sync::restart(&watcher, &app, new_path);
    emit_changed(&app);
    Ok(data_location(&state, &config))
}

// ───────────────────────── Android SAF folder sync ─────────────────────────
// Mirror the app-private tasks.json (and Syncthing conflict copies) to/from a
// user-picked SAF folder (e.g. a Google Drive or Syncthing folder). All SAF I/O
// lives behind a trait in safsync.rs; these commands wire it to the app. Desktop
// builds get inert stubs so the command names always resolve in generate_handler!.

#[cfg(target_os = "android")]
fn saf_delete_conflict(app: &AppHandle, conflict_path: &std::path::Path) {
    use crate::safsync::SafBackend as _;
    let Some(name) = conflict_path.file_name().and_then(|s| s.to_str()) else { return };
    let saf = app.state::<crate::safsync::SafSync>();
    let folder_json = saf.inner.lock().unwrap().folder_uri_json.clone();
    if let Some(json) = folder_json {
        if let Ok(backend) = crate::safsync::android::AndroidSafBackend::from_json(app, &json) {
            let _ = backend.delete_file(name);
        }
    }
}

#[cfg(target_os = "android")]
fn saf_conflict_count(path: &std::path::Path) -> usize {
    scan_conflict_files(path).len()
}

/// Persist the current link + last-synced hash to the device-local sidecar so a
/// cold start can restore the hash and avoid clobbering a remote that another
/// device updated while this app was closed (#Phase 4B).
#[cfg(target_os = "android")]
fn saf_persist(state: &AppState, saf: &crate::safsync::SafSync) {
    let cfg = {
        let g = saf.inner.lock().unwrap();
        crate::safsync::SyncConfig {
            folder_uri_json: g.folder_uri_json.clone(),
            folder_label: g.folder_label.clone(),
            last_synced_hash: g.last_synced_hash,
        }
    };
    let _ = crate::safsync::save_config(&state.path(), &cfg);
}

/// Pull the remote into the app-private master. Returns `(ok, status)` where
/// `ok` is false when the remote couldn't be read — callers MUST NOT push after
/// a failed pull, or a transient unreadable remote would be overwritten by this
/// device's copy (the Google Drive data-loss bug). A folder that simply has no
/// remote yet pulls cleanly (`ok = true`).
#[cfg(target_os = "android")]
fn saf_run_pull(app: &AppHandle, state: &AppState, saf: &crate::safsync::SafSync) -> (bool, crate::safsync::SyncStatus) {
    use crate::safsync::{self, android::AndroidSafBackend};
    let path = state.path();
    let (folder_json, last_hash) = {
        let g = saf.inner.lock().unwrap();
        (g.folder_uri_json.clone(), g.last_synced_hash)
    };
    let mut conflicts = 0usize;
    let mut ok = true;
    if let Some(json) = folder_json {
        match AndroidSafBackend::from_json(app, &json) {
            Ok(backend) => match safsync::pull_in(state, &backend, &path, last_hash) {
                Ok(out) => {
                    {
                        let mut g = saf.inner.lock().unwrap();
                        g.last_synced_hash = out.new_synced_hash;
                        g.last_synced_ms = Some(now_ms());
                        g.last_error = None;
                    }
                    conflicts = out.conflict_count;
                    if out.imported {
                        let _ = app.emit(STORE_CHANGED, ());
                    }
                    saf_persist(state, saf); // persist the advanced last_synced_hash
                    let _ = app.emit("conflicts-detected", &scan_conflict_files(&path));
                }
                Err(e) => { saf.inner.lock().unwrap().last_error = Some(e.to_string()); ok = false; }
            },
            Err(e) => { saf.inner.lock().unwrap().last_error = Some(e.to_string()); ok = false; }
        }
    }
    (ok, saf.status(conflicts))
}

/// Switch the data source to the linked folder: discard the local in-memory
/// document and load the folder's `tasks.json` outright (no conflict file). Used
/// only by the explicit folder-pick action, not routine sync.
#[cfg(target_os = "android")]
fn saf_run_switch(app: &AppHandle, state: &AppState, saf: &crate::safsync::SafSync) -> crate::safsync::SyncStatus {
    use crate::safsync::{self, android::AndroidSafBackend};
    let path = state.path();
    let folder_json = saf.inner.lock().unwrap().folder_uri_json.clone();
    let mut conflicts = 0usize;
    if let Some(json) = folder_json {
        match AndroidSafBackend::from_json(app, &json) {
            Ok(backend) => match safsync::switch_to_remote(state, &backend, &path) {
                Ok(out) => {
                    {
                        let mut g = saf.inner.lock().unwrap();
                        g.last_synced_hash = out.new_synced_hash;
                        g.last_synced_ms = Some(now_ms());
                        g.last_error = None;
                    }
                    conflicts = out.conflict_count;
                    if out.imported {
                        let _ = app.emit(STORE_CHANGED, ());
                    }
                    saf_persist(state, saf);
                    let _ = app.emit("conflicts-detected", &scan_conflict_files(&path));
                }
                Err(e) => { saf.inner.lock().unwrap().last_error = Some(e.to_string()); }
            },
            Err(e) => { saf.inner.lock().unwrap().last_error = Some(e.to_string()); }
        }
    }
    saf.status(conflicts)
}

#[cfg(target_os = "android")]
fn saf_run_push(app: &AppHandle, state: &AppState, saf: &crate::safsync::SafSync) -> crate::safsync::SyncStatus {
    use crate::safsync::{self, android::AndroidSafBackend};
    let (folder_json, last_hash) = {
        let g = saf.inner.lock().unwrap();
        (g.folder_uri_json.clone(), g.last_synced_hash)
    };
    if let Some(json) = folder_json {
        match AndroidSafBackend::from_json(app, &json) {
            Ok(backend) => match safsync::push_out(state, &backend, last_hash) {
                Ok(Some(h)) => {
                    {
                        let mut g = saf.inner.lock().unwrap();
                        g.last_synced_hash = Some(h);
                        g.last_synced_ms = Some(now_ms());
                        g.last_error = None;
                    }
                    saf_persist(state, saf); // persist the advanced last_synced_hash
                }
                Ok(None) => {}
                Err(e) => { saf.inner.lock().unwrap().last_error = Some(e.to_string()); }
            },
            Err(e) => { saf.inner.lock().unwrap().last_error = Some(e.to_string()); }
        }
    }
    saf.status(saf_conflict_count(&state.path()))
}

/// Open the SAF folder picker, persist permission, save the link, and seed/pull.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn saf_pick_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    saf: State<'_, crate::safsync::SafSync>,
) -> Result<crate::safsync::SyncStatus> {
    use crate::safsync::{self, LinkAction};
    let picked = safsync::android::pick_and_persist(&app).await?;
    if let Some((json, label)) = picked {
        {
            let mut g = saf.inner.lock().unwrap();
            g.folder_uri_json = Some(json.clone());
            g.folder_label = Some(label.clone());
            g.permission_ok = true;
            g.last_synced_hash = None; // force a real sync on first link
            g.last_error = None;
        }
        safsync::save_config(&state.path(), &safsync::SyncConfig {
            folder_uri_json: Some(json.clone()),
            folder_label: Some(label),
            last_synced_hash: None, // the seed/pull below persists the real hash
        })?;
        // Choosing a folder, decided fail-safe. If it already has a tasks.json,
        // SWITCH to it: discard the local in-memory document and load the folder's
        // data outright (no conflict file). If the folder is confirmed empty, SEED
        // it from this device's document. If the folder can't be read, ABORT rather
        // than risk overwriting an existing remote (the Google Drive data-loss
        // bug): surface the error and leave the remote untouched.
        let backend = safsync::android::AndroidSafBackend::from_json(&app, &json)?;
        return Ok(match safsync::first_link_action(&backend) {
            LinkAction::Pull => saf_run_switch(&app, &state, &saf),
            LinkAction::Seed => saf_run_push(&app, &state, &saf),
            LinkAction::Abort => {
                let msg = "Couldn't read the selected folder, so its contents were left untouched. \
                           Check the folder is reachable and try linking again.";
                saf.inner.lock().unwrap().last_error = Some(msg.into());
                saf.status(saf_conflict_count(&state.path()))
            }
        });
    }
    Ok(saf.status(saf_conflict_count(&state.path())))
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn saf_clear_folder(
    state: State<'_, AppState>,
    saf: State<'_, crate::safsync::SafSync>,
) -> Result<()> {
    {
        let mut g = saf.inner.lock().unwrap();
        g.folder_uri_json = None;
        g.folder_label = None;
        g.permission_ok = false;
        g.last_synced_hash = None;
        g.last_error = None;
    }
    crate::safsync::save_config(&state.path(), &crate::safsync::SyncConfig::default())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn saf_push(
    app: AppHandle,
    state: State<'_, AppState>,
    saf: State<'_, crate::safsync::SafSync>,
) -> crate::safsync::SyncStatus {
    saf_run_push(&app, &state, &saf)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn saf_sync_now(
    app: AppHandle,
    state: State<'_, AppState>,
    saf: State<'_, crate::safsync::SafSync>,
) -> crate::safsync::SyncStatus {
    // Pull first so a remote another device updated is adopted (diverged local
    // edits are preserved as a conflict file) BEFORE we push — otherwise a cold
    // start would push this device's stale copy over the newer remote (#Phase 4B).
    // Only push if the pull SUCCEEDED: if the remote couldn't be read, pushing now
    // would overwrite it with this device's copy (the Google Drive data-loss bug).
    let (pull_ok, status) = saf_run_pull(&app, &state, &saf);
    if pull_ok {
        saf_run_push(&app, &state, &saf)
    } else {
        status
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn saf_status(
    state: State<'_, AppState>,
    saf: State<'_, crate::safsync::SafSync>,
) -> crate::safsync::SyncStatus {
    saf.status(saf_conflict_count(&state.path()))
}

// Desktop/iOS stubs (no SAF): keep the command names resolvable for the handler.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn saf_pick_folder() -> crate::safsync::SyncStatus { crate::safsync::SyncStatus::unlinked() }
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn saf_clear_folder() -> Result<()> { Ok(()) }
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn saf_push() -> crate::safsync::SyncStatus { crate::safsync::SyncStatus::unlinked() }
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn saf_sync_now() -> crate::safsync::SyncStatus { crate::safsync::SyncStatus::unlinked() }
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn saf_status() -> crate::safsync::SyncStatus { crate::safsync::SyncStatus::unlinked() }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_task_input_absent_field_stays_none() {
        let v: UpdateTaskInput = serde_json::from_str(r#"{"id":"t_1"}"#).unwrap();
        assert_eq!(v.due_date, None);
        assert_eq!(v.start_date, None);
    }

    #[test]
    fn update_task_input_null_field_clears() {
        let v: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","due_date":null,"start_date":null}"#).unwrap();
        assert_eq!(v.due_date, Some(None));
        assert_eq!(v.start_date, Some(None));
    }

    #[test]
    fn update_task_input_value_sets_field() {
        let v: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","due_date":"2026-06-01"}"#).unwrap();
        assert_eq!(v.due_date, Some(Some(NaiveDate::from_ymd_opt(2026, 6, 1).unwrap())));
    }

    #[test]
    fn task_time_fields_round_trip_and_clear(/* #93 */) {
        // Absent -> None (leave), null -> Some(None) (clear), value -> Some(Some) (set).
        let absent: UpdateTaskInput = serde_json::from_str(r#"{"id":"t_1"}"#).unwrap();
        assert_eq!(absent.start_time, None);
        assert_eq!(absent.due_time, None);
        let cleared: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","start_time":null,"due_time":null}"#).unwrap();
        assert_eq!(cleared.start_time, Some(None));
        assert_eq!(cleared.due_time, Some(None));
        let set: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","start_time":"09:30"}"#).unwrap();
        assert_eq!(set.start_time, Some(Some("09:30".to_string())));
        let new: NewTaskInput =
            serde_json::from_str(r#"{"title":"t","due_time":"23:59"}"#).unwrap();
        assert_eq!(new.due_time.as_deref(), Some("23:59"));
    }

    #[test]
    fn validate_time_accepts_hh_mm_and_rejects_garbage(/* #93 */) {
        assert!(validate_time(None).is_ok());          // all-day
        assert!(validate_time(Some("00:00")).is_ok());
        assert!(validate_time(Some("09:30")).is_ok());
        assert!(validate_time(Some("23:59")).is_ok());
        assert!(validate_time(Some("24:00")).is_err());    // hour out of range
        assert!(validate_time(Some("5pm")).is_err());      // not HH:MM
        assert!(validate_time(Some("09:30:00")).is_err()); // trailing seconds
    }

    #[test]
    fn update_tag_input_priority_parses() {
        let v: UpdateTagInput =
            serde_json::from_str(r#"{"id":"t_1","priority":9}"#).unwrap();
        assert_eq!(v.priority, Some(9));
        let absent: UpdateTagInput = serde_json::from_str(r#"{"id":"t_1"}"#).unwrap();
        assert_eq!(absent.priority, None);
    }

    #[test]
    fn update_tag_input_pinned_parses() {
        // An absent `pinned` leaves the tag's flag untouched (None); a present
        // value drives the toggle (#78).
        let absent: UpdateTagInput = serde_json::from_str(r#"{"id":"t_1"}"#).unwrap();
        assert_eq!(absent.pinned, None);
        let set: UpdateTagInput =
            serde_json::from_str(r#"{"id":"t_1","pinned":true}"#).unwrap();
        assert_eq!(set.pinned, Some(true));
    }

    #[test]
    fn new_tag_input_priority_defaults_zero() {
        let v: NewTagInput = serde_json::from_str(r##"{"name":"x","color":"#fff"}"##).unwrap();
        assert_eq!(v.priority, 0);
    }

    #[test]
    fn new_tag_input_pinned_defaults_false() {
        let v: NewTagInput = serde_json::from_str(r##"{"name":"x","color":"#fff"}"##).unwrap();
        assert!(!v.pinned);
        let pinned: NewTagInput =
            serde_json::from_str(r##"{"name":"x","color":"#fff","pinned":true}"##).unwrap();
        assert!(pinned.pinned);
    }

    #[test]
    fn retain_known_tags_strips_unknown_ids() {
        let tags = vec![
            Tag { id: "t_known".into(), name: "k".into(), color: "#000".into(), priority: 0, pinned: false },
        ];
        let out = retain_known_tags(
            vec!["t_known".into(), "t_unknown".into(), "t_known".into()],
            &tags,
        );
        assert_eq!(out, vec!["t_known".to_string(), "t_known".to_string()]);
    }

    #[test]
    fn retain_known_tags_empty_when_no_tags_exist() {
        let out = retain_known_tags(vec!["t_x".into(), "t_y".into()], &[]);
        assert!(out.is_empty());
    }

    #[test]
    fn update_settings_input_parses_sort_order() {
        // Pins the snake_case `sort_order` key that the JS api sends.
        let v: UpdateSettingsInput = serde_json::from_str(r#"{"sort_order":"date"}"#).unwrap();
        assert_eq!(v.sort_order.as_deref(), Some("date"));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.sort_order, None);
        assert_eq!(absent.theme, None);
    }

    #[test]
    fn update_settings_input_parses_upcoming_days() {
        // Pins the snake_case `upcoming_days` key that the JS api sends.
        let v: UpdateSettingsInput = serde_json::from_str(r#"{"upcoming_days":30}"#).unwrap();
        assert_eq!(v.upcoming_days, Some(30));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.upcoming_days, None);
    }

    #[test]
    fn update_settings_input_parses_day_start_hour() {
        // Pins the snake_case `day_start_hour` key that the JS api sends.
        let v: UpdateSettingsInput = serde_json::from_str(r#"{"day_start_hour":4}"#).unwrap();
        assert_eq!(v.day_start_hour, Some(4));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.day_start_hour, None);
    }

    #[test]
    fn update_settings_input_parses_new_tag_defaults() {
        // Pins the snake_case keys the JS api sends (#79).
        let v: UpdateSettingsInput =
            serde_json::from_str(r##"{"default_tag_color":"#ef4444","default_tag_priority":7}"##)
                .unwrap();
        assert_eq!(v.default_tag_color.as_deref(), Some("#ef4444"));
        assert_eq!(v.default_tag_priority, Some(7));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.default_tag_color, None);
        assert_eq!(absent.default_tag_priority, None);
    }

    #[test]
    fn is_hex_color_accepts_short_and_long_forms() {
        assert!(is_hex_color("#10b981"));
        assert!(is_hex_color("#FFF"));
        assert!(is_hex_color("#abcDEF"));
    }

    #[test]
    fn is_hex_color_rejects_malformed_values() {
        assert!(!is_hex_color("10b981")); // no leading '#'
        assert!(!is_hex_color("#12g456")); // non-hex digit
        assert!(!is_hex_color("#1234")); // wrong length
        assert!(!is_hex_color("#")); // empty body
        assert!(!is_hex_color("red")); // not hex at all
    }

    #[test]
    fn validate_conflict_path_accepts_a_scanner_named_file_in_the_data_dir() {
        let data = Path::new("/data/tasks.json");
        // Matches store.rs's `{stem}.conflict-local-{ms}.json` shape.
        assert!(validate_conflict_path("/data/tasks.conflict-local-123.json", data).is_ok());
        // And a cloud-sync sibling the scanner would also surface.
        assert!(validate_conflict_path("/data/tasks.sync-conflict-1.json", data).is_ok());
    }

    #[test]
    fn validate_conflict_path_rejects_a_path_outside_the_data_dir() {
        let data = Path::new("/data/tasks.json");
        assert!(validate_conflict_path("/etc/passwd", data).is_err());
        // Right name, wrong directory.
        assert!(validate_conflict_path("/other/tasks.conflict-local-1.json", data).is_err());
        // A `..` escape resolves to a different parent, so it's rejected.
        assert!(validate_conflict_path("/data/sub/../tasks.conflict-local-1.json", data).is_err());
    }

    #[test]
    fn validate_conflict_path_rejects_the_data_file_and_non_conflict_siblings() {
        let data = Path::new("/data/tasks.json");
        assert!(validate_conflict_path("/data/tasks.json", data).is_err());
        assert!(validate_conflict_path("/data/notes.txt", data).is_err());
        // Same dir + .json but neither mentions "conflict" nor starts with the stem.
        assert!(validate_conflict_path("/data/random.json", data).is_err());
    }

    #[test]
    fn validate_conflict_path_filename_match_is_case_insensitive() {
        // Mirrors scan_conflict_files's lowercasing so a Windows-cased name isn't
        // rejected when the scanner would have surfaced it.
        let data = Path::new("/data/tasks.json");
        assert!(validate_conflict_path("/data/Tasks.CONFLICT-local-1.JSON", data).is_ok());
    }

    #[test]
    fn new_template_input_parses_offset_fields() {
        // Pins the snake_case keys the JS api sends for a template (#71).
        let v: NewTemplateInput = serde_json::from_str(
            r#"{"title":"t","due_offset_days":3,"start_offset_days":0,"notes":"n","tag_ids":["t_x"]}"#,
        ).unwrap();
        assert_eq!(v.due_offset_days, Some(3));
        assert_eq!(v.start_offset_days, Some(0));
        assert_eq!(v.notes, "n");
        assert_eq!(v.tag_ids, ["t_x"]);
        // Absent offsets default to None (no spawned date).
        let plain: NewTemplateInput = serde_json::from_str(r#"{"title":"t"}"#).unwrap();
        assert_eq!(plain.due_offset_days, None);
        assert_eq!(plain.start_offset_days, None);
    }

    #[test]
    fn update_template_input_offset_double_option_distinguishes_absent_null_value() {
        // Mirrors the due_date double_option semantics for offsets.
        let absent: UpdateTemplateInput = serde_json::from_str(r#"{"id":"k_1"}"#).unwrap();
        assert_eq!(absent.due_offset_days, None);
        assert_eq!(absent.title, None);
        let cleared: UpdateTemplateInput =
            serde_json::from_str(r#"{"id":"k_1","due_offset_days":null}"#).unwrap();
        assert_eq!(cleared.due_offset_days, Some(None));
        let set: UpdateTemplateInput =
            serde_json::from_str(r#"{"id":"k_1","title":"x","due_offset_days":5}"#).unwrap();
        assert_eq!(set.title.as_deref(), Some("x"));
        assert_eq!(set.due_offset_days, Some(Some(5)));
    }

    #[test]
    fn validate_offset_days_bounds() {
        assert!(validate_offset_days(None).is_ok());
        assert!(validate_offset_days(Some(0)).is_ok());
        assert!(validate_offset_days(Some(OFFSET_DAYS_MAX)).is_ok());
        assert!(validate_offset_days(Some(-1)).is_err());
        assert!(validate_offset_days(Some(OFFSET_DAYS_MAX + 1)).is_err());
    }
}
