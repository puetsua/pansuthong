use crate::conflict::{apply_decisions, diff_tasks, tags_to_merge, Decision, TaskDiff};
use crate::error::{AppError, Result};
use crate::model::{new_tag_id, new_task_id, now_ms, Document, Tag, Task};
use crate::search::search as search_doc;
use crate::store::AppState;
use crate::sync::scan_conflict_files;
use chrono::{Duration, Local, NaiveDate};
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
    #[serde(default)] pub is_template: bool,
    #[serde(default)] pub due_offset_days: Option<i64>,
    #[serde(default)] pub scheduled_offset_days: Option<i64>,
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

/// `today + days`, or `None` when the template carries no offset. The offset is
/// clamped to the valid range so even a hand-edited out-of-range value can't panic
/// the date math.
fn date_from_offset(today: NaiveDate, days: Option<i64>) -> Option<NaiveDate> {
    days.map(|n| today + Duration::days(n.clamp(0, OFFSET_DAYS_MAX)))
}

#[tauri::command]
pub fn add_task(input: NewTaskInput, state: State<'_, AppState>, app: AppHandle) -> Result<Task> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid("title is empty".into()));
    }
    validate_offset_days(input.due_offset_days)?;
    validate_offset_days(input.scheduled_offset_days)?;
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
            is_template: input.is_template,
            due_offset_days: input.due_offset_days,
            scheduled_offset_days: input.scheduled_offset_days,
        };
        d.tasks.push(task.clone());
        Ok(task)
    })?;
    emit_changed(&app);
    Ok(saved)
}

#[derive(Deserialize)]
pub struct CreateFromTemplateInput {
    pub template_id: String,
}

/// Build the fresh, independent task a template spawns: copy title/notes/tag_ids
/// and resolve the template's relative offsets into absolute dates (today + offset).
/// The result is an ordinary task — is_template = false with no offsets — so editing
/// or completing it never affects the template (#71). Pure over (tpl, today, ts) so
/// the instantiation invariants are unit-testable without a Tauri State.
fn instantiate_template(tpl: &Task, today: NaiveDate, ts: i64) -> Task {
    Task {
        id: new_task_id(),
        title: tpl.title.clone(),
        done: false,
        due_date: date_from_offset(today, tpl.due_offset_days),
        scheduled_date: date_from_offset(today, tpl.scheduled_offset_days),
        notes: tpl.notes.clone(),
        // The template's tag_ids were filtered to known tags when it was saved.
        tag_ids: tpl.tag_ids.clone(),
        created_at: ts,
        completed_at: None,
        updated_at: ts,
        archived: false,
        archived_at: None,
        is_template: false,
        due_offset_days: None,
        scheduled_offset_days: None,
    }
}

/// Instantiate a fresh, independent task from a template (see `instantiate_template`).
#[tauri::command]
pub fn create_task_from_template(
    input: CreateFromTemplateInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Task> {
    let today = Local::now().date_naive();
    let ts = now_ms();
    let saved = state.write(|d| {
        let tpl = d
            .tasks
            .iter()
            .find(|t| t.id == input.template_id && t.is_template)
            .ok_or_else(|| AppError::NotFound(format!("template {}", input.template_id)))?;
        let task = instantiate_template(tpl, today, ts);
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
    #[serde(default)] pub is_template: Option<bool>,
    #[serde(default, deserialize_with = "double_option")] pub due_offset_days: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")] pub scheduled_offset_days: Option<Option<i64>>,
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
        if let Some(v) = input.is_template    { t.is_template = v; }
        if let Some(v) = input.due_offset_days       { validate_offset_days(v)?; t.due_offset_days = v; }
        if let Some(v) = input.scheduled_offset_days { validate_offset_days(v)?; t.scheduled_offset_days = v; }
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

    #[test]
    fn new_task_input_parses_template_fields() {
        // Pins the snake_case keys the JS api sends for a template (#71).
        let v: NewTaskInput = serde_json::from_str(
            r#"{"title":"t","is_template":true,"due_offset_days":3,"scheduled_offset_days":0}"#,
        ).unwrap();
        assert!(v.is_template);
        assert_eq!(v.due_offset_days, Some(3));
        assert_eq!(v.scheduled_offset_days, Some(0));
        // Absent template fields default to a plain task.
        let plain: NewTaskInput = serde_json::from_str(r#"{"title":"t"}"#).unwrap();
        assert!(!plain.is_template);
        assert_eq!(plain.due_offset_days, None);
    }

    #[test]
    fn update_task_input_offset_double_option_distinguishes_absent_null_value() {
        // Mirrors the due_date double_option semantics for offsets.
        let absent: UpdateTaskInput = serde_json::from_str(r#"{"id":"k_1"}"#).unwrap();
        assert_eq!(absent.due_offset_days, None);
        assert_eq!(absent.is_template, None);
        let cleared: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"k_1","due_offset_days":null}"#).unwrap();
        assert_eq!(cleared.due_offset_days, Some(None));
        let set: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"k_1","is_template":true,"due_offset_days":5}"#).unwrap();
        assert_eq!(set.is_template, Some(true));
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

    #[test]
    fn date_from_offset_adds_days_and_clamps() {
        let today = NaiveDate::from_ymd_opt(2026, 5, 31).unwrap();
        assert_eq!(date_from_offset(today, None), None);
        assert_eq!(date_from_offset(today, Some(0)), Some(today));
        assert_eq!(
            date_from_offset(today, Some(3)),
            Some(NaiveDate::from_ymd_opt(2026, 6, 3).unwrap())
        );
        // A corrupt out-of-range offset is clamped, never panics.
        assert_eq!(
            date_from_offset(today, Some(i64::MAX)),
            Some(today + Duration::days(OFFSET_DAYS_MAX))
        );
    }

    fn template(id: &str) -> Task {
        Task {
            id: id.into(), title: "Weekly report".into(), done: false,
            due_date: None, scheduled_date: None, notes: "agenda".into(),
            tag_ids: vec!["t_work".into()], created_at: 1, completed_at: None, updated_at: 1,
            archived: false, archived_at: None,
            is_template: true, due_offset_days: Some(3), scheduled_offset_days: Some(0),
        }
    }

    #[test]
    fn instantiate_template_spawns_independent_task_with_resolved_dates() {
        let today = NaiveDate::from_ymd_opt(2026, 5, 31).unwrap();
        let t = instantiate_template(&template("k_tmpl"), today, 999);

        // The spawned task is an ordinary task, never itself a template (else it
        // would vanish from every active view).
        assert!(!t.is_template);
        assert_eq!(t.due_offset_days, None);
        assert_eq!(t.scheduled_offset_days, None);
        assert_ne!(t.id, "k_tmpl");
        // Copies title / notes / tags.
        assert_eq!(t.title, "Weekly report");
        assert_eq!(t.notes, "agenda");
        assert_eq!(t.tag_ids, vec!["t_work".to_string()]);
        // Relative offsets resolved to absolute dates (today + offset).
        assert_eq!(t.scheduled_date, Some(today));
        assert_eq!(t.due_date, Some(NaiveDate::from_ymd_opt(2026, 6, 3).unwrap()));
        // Stamped fresh, not done/archived.
        assert!(!t.done && !t.archived);
        assert_eq!(t.created_at, 999);
        assert_eq!(t.updated_at, 999);
    }

    #[test]
    fn instantiate_template_without_offsets_leaves_dates_unset() {
        let today = NaiveDate::from_ymd_opt(2026, 5, 31).unwrap();
        let mut tpl = template("k_tmpl");
        tpl.due_offset_days = None;
        tpl.scheduled_offset_days = None;
        let t = instantiate_template(&tpl, today, 0);
        assert_eq!(t.due_date, None);
        assert_eq!(t.scheduled_date, None);
    }
}
