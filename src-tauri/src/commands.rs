use crate::conflict::{apply_decisions, diff_tasks, tags_to_merge, Decision, TaskDiff};
use crate::error::{AppError, Result};
use crate::model::{new_tag_id, new_task_id, now_ms, Document, Tag, Task};
use crate::parse::{parse as parse_input, ParsedInput};
use crate::search::search as search_doc;
use crate::store::AppState;
use crate::sync::scan_conflict_files;
use chrono::{Local, NaiveDate};
use serde::{Deserialize, Deserializer};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};

const STORE_CHANGED: &str = "store-changed";

fn emit_changed(app: &AppHandle) {
    let _ = app.emit(STORE_CHANGED, ());
}

#[tauri::command]
pub fn get_document(state: State<'_, AppState>) -> Document {
    state.read(|d| d.clone())
}

/// Manual "Sync now": re-read the data file from disk immediately instead of
/// waiting for the polling fallback. Picks up changes a cloud-sync client
/// (Google Drive) pulled in from another device. Returns the freshest document.
#[tauri::command]
pub fn sync_now(state: State<'_, AppState>, app: AppHandle) -> Document {
    let path = state.path();
    if crate::sync::reload_if_changed(&state, &path) {
        emit_changed(&app);
    }
    state.read(|d| d.clone())
}

#[derive(Deserialize)]
pub struct NewTaskInput {
    pub title: String,
    #[serde(default)] pub due_date: Option<NaiveDate>,
    #[serde(default)] pub scheduled_date: Option<NaiveDate>,
    #[serde(default)] pub notes: String,
    #[serde(default)] pub tag_ids: Vec<String>,
}

/// Drop tag ids that don't exist in the document so tasks never persist dangling
/// tag references (which silently behave as untagged, landing in Inbox at
/// priority 0) (#40).
fn retain_known_tags(ids: Vec<String>, tags: &[Tag]) -> Vec<String> {
    ids.into_iter().filter(|id| tags.iter().any(|t| &t.id == id)).collect()
}

#[tauri::command]
pub fn add_task(input: NewTaskInput, state: State<'_, AppState>, app: AppHandle) -> Result<Task> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid("title is empty".into()));
    }
    let ts = now_ms();
    let saved = state.write(|d| {
        let task = Task {
            id: new_task_id(),
            title,
            done: false,
            due_date: input.due_date,
            scheduled_date: input.scheduled_date,
            notes: input.notes,
            tag_ids: retain_known_tags(input.tag_ids, &d.tags),
            created_at: ts,
            completed_at: None,
            updated_at: ts,
            archived: false,
            archived_at: None,
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

// `due_date` and `scheduled_date` are `Option<Option<_>>` decoded with the
// `double_option` deserializer above, so the edit UI can distinguish "field absent
// (don't change)" from "field is null (clear it)".
#[derive(Deserialize)]
pub struct UpdateTaskInput {
    pub id: String,
    #[serde(default)] pub title: Option<String>,
    #[serde(default, deserialize_with = "double_option")] pub due_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")] pub scheduled_date: Option<Option<NaiveDate>>,
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
        if let Some(v) = input.due_date       { t.due_date = v; }
        if let Some(v) = input.scheduled_date { t.scheduled_date = v; }
        if let Some(v) = input.notes          { t.notes = v; }
        if let Some(v) = input.tag_ids        {
            t.tag_ids = v.into_iter().filter(|id| known.contains(id)).collect();
        }
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

/// Bulk-archive every completed-but-not-yet-archived task. Returns how many were
/// archived; only emits a change (and bumps timestamps) when at least one moved (#23).
#[tauri::command]
pub fn archive_completed(state: State<'_, AppState>, app: AppHandle) -> Result<usize> {
    let archived = state.write(|d| {
        let ts = now_ms();
        let mut count = 0usize;
        for t in d.tasks.iter_mut() {
            if t.done && !t.archived {
                t.archived = true;
                t.archived_at = Some(ts);
                t.updated_at = ts;
                count += 1;
            }
        }
        Ok(count)
    })?;
    if archived > 0 {
        emit_changed(&app);
    }
    Ok(archived)
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

#[derive(Deserialize)]
pub struct NewTagInput {
    pub name: String,
    pub color: String,
    #[serde(default)] pub priority: i64,
}

#[tauri::command]
pub fn add_tag(input: NewTagInput, state: State<'_, AppState>, app: AppHandle) -> Result<Tag> {
    let t = Tag { id: new_tag_id(), name: input.name, color: input.color, priority: input.priority };
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
        Ok(())
    })?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn parse_composer(input: String) -> ParsedInput {
    let today = Local::now().date_naive();
    parse_input(&input, today)
}

#[tauri::command]
pub fn search_tasks(query: String, state: State<'_, AppState>) -> Vec<crate::model::Task> {
    state.read(|d| search_doc(d, &query).into_iter().cloned().collect())
}

#[derive(Deserialize)]
pub struct UpdateTagInput {
    pub id:    String,
    #[serde(default)] pub name:     Option<String>,
    #[serde(default)] pub color:    Option<String>,
    #[serde(default)] pub priority: Option<i64>,
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
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

/// Bounds for the configurable Upcoming horizon (#25).
const UPCOMING_DAYS_MIN: u32 = 1;
const UPCOMING_DAYS_MAX: u32 = 365;

#[derive(Deserialize)]
pub struct UpdateSettingsInput {
    #[serde(default)] pub theme: Option<String>,
    #[serde(default)] pub sort_order: Option<String>,
    #[serde(default)] pub upcoming_days: Option<u32>,
}

#[tauri::command]
pub fn update_settings(input: UpdateSettingsInput, state: State<'_, AppState>, app: AppHandle) -> Result<()> {
    state.write(|d| {
        if let Some(t) = input.theme {
            if !matches!(t.as_str(), "auto" | "light" | "dark") {
                return Err(AppError::Invalid(format!("invalid theme: {t}")));
            }
            d.settings.theme = t;
        }
        if let Some(s) = input.sort_order {
            if !matches!(s.as_str(), "priority" | "date") {
                return Err(AppError::Invalid(format!("invalid sort_order: {s}")));
            }
            d.settings.sort_order = s;
        }
        if let Some(n) = input.upcoming_days {
            if !(UPCOMING_DAYS_MIN..=UPCOMING_DAYS_MAX).contains(&n) {
                return Err(AppError::Invalid(format!(
                    "upcoming_days must be {UPCOMING_DAYS_MIN}..={UPCOMING_DAYS_MAX}, got {n}"
                )));
            }
            d.settings.upcoming_days = n;
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
    emit_changed(&app);
    let data_path: PathBuf = state.path();
    let _ = app.emit("conflicts-detected", &scan_conflict_files(&data_path));
    Ok(())
}

#[tauri::command]
pub fn dismiss_conflict(conflict_path: String, app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    let path = validate_conflict_path(&conflict_path, &state.path())?;
    let _ = std::fs::remove_file(&path);
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

#[tauri::command]
pub fn get_data_location(state: State<'_, AppState>, app: AppHandle) -> Result<DataLocation> {
    let cfg = crate::location::load(&default_data_dir(&app)?);
    Ok(DataLocation {
        folder: cfg.folder,
        effective_path: state.path().to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn set_data_folder(
    folder: String,
    state: State<'_, AppState>,
    watcher: State<'_, crate::sync::WatcherHandle>,
    app: AppHandle,
) -> Result<DataLocation> {
    let folder_path = PathBuf::from(&folder);
    if !folder_path.is_dir() {
        return Err(AppError::Invalid(format!("not a folder: {folder}")));
    }
    let new_path = folder_path.join("tasks.json");
    state.repoint(new_path.clone())?;
    crate::location::save(
        &default_data_dir(&app)?,
        &crate::location::DataLocationConfig { folder: Some(folder) },
    )?;
    crate::sync::restart(&watcher, &app, new_path);
    emit_changed(&app);
    let _ = app.emit("conflicts-detected", &crate::sync::scan_conflict_files(&state.path()));
    get_data_location(state, app.clone())
}

#[tauri::command]
pub fn clear_data_folder(
    state: State<'_, AppState>,
    watcher: State<'_, crate::sync::WatcherHandle>,
    app: AppHandle,
) -> Result<DataLocation> {
    let default_dir = default_data_dir(&app)?;
    let new_path = default_dir.join("tasks.json");
    state.repoint(new_path.clone())?;
    crate::location::save(&default_dir, &crate::location::DataLocationConfig { folder: None })?;
    crate::sync::restart(&watcher, &app, new_path);
    emit_changed(&app);
    get_data_location(state, app.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_task_input_absent_field_stays_none() {
        let v: UpdateTaskInput = serde_json::from_str(r#"{"id":"t_1"}"#).unwrap();
        assert_eq!(v.due_date, None);
        assert_eq!(v.scheduled_date, None);
    }

    #[test]
    fn update_task_input_null_field_clears() {
        let v: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","due_date":null,"scheduled_date":null}"#).unwrap();
        assert_eq!(v.due_date, Some(None));
        assert_eq!(v.scheduled_date, Some(None));
    }

    #[test]
    fn update_task_input_value_sets_field() {
        let v: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","due_date":"2026-06-01"}"#).unwrap();
        assert_eq!(v.due_date, Some(Some(NaiveDate::from_ymd_opt(2026, 6, 1).unwrap())));
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
    fn new_tag_input_priority_defaults_zero() {
        let v: NewTagInput = serde_json::from_str(r##"{"name":"x","color":"#fff"}"##).unwrap();
        assert_eq!(v.priority, 0);
    }

    #[test]
    fn retain_known_tags_strips_unknown_ids() {
        let tags = vec![
            Tag { id: "t_known".into(), name: "k".into(), color: "#000".into(), priority: 0 },
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
}
