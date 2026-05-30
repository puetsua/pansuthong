use crate::conflict::{apply_decisions, diff_tasks, Decision, TaskDiff};
use crate::error::{AppError, Result};
use crate::model::{new_project_id, new_tag_id, new_task_id, now_ms, Document, Priority, Project, Tag, Task};
use crate::parse::{parse as parse_input, ParsedInput};
use crate::search::search as search_doc;
use crate::store::AppState;
use crate::sync::scan_conflict_files;
use chrono::{Local, NaiveDate};
use serde::{Deserialize, Deserializer};
use std::path::PathBuf;
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
    #[serde(default)] pub priority: Option<Priority>,
    #[serde(default)] pub notes: String,
    #[serde(default)] pub tag_ids: Vec<String>,
}

#[tauri::command]
pub fn add_task(input: NewTaskInput, state: State<'_, AppState>, app: AppHandle) -> Result<Task> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid("title is empty".into()));
    }
    let ts = now_ms();
    let task = Task {
        id: new_task_id(),
        title,
        done: false,
        due_date: input.due_date,
        scheduled_date: input.scheduled_date,
        priority: input.priority,
        notes: input.notes,
        tag_ids: input.tag_ids,
        created_at: ts,
        completed_at: None,
        updated_at: ts,
    };
    let saved = state.write(|d| { d.tasks.push(task.clone()); Ok(task) })?;
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

// `due_date`, `scheduled_date`, and `priority` are `Option<Option<_>>` decoded with the
// `double_option` deserializer above, so the edit UI can distinguish "field absent
// (don't change)" from "field is null (clear it)".
#[derive(Deserialize)]
pub struct UpdateTaskInput {
    pub id: String,
    #[serde(default)] pub title: Option<String>,
    #[serde(default, deserialize_with = "double_option")] pub due_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")] pub scheduled_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")] pub priority: Option<Option<Priority>>,
    #[serde(default)] pub notes: Option<String>,
    #[serde(default)] pub tag_ids: Option<Vec<String>>,
}

#[tauri::command]
pub fn update_task(input: UpdateTaskInput, state: State<'_, AppState>, app: AppHandle) -> Result<Task> {
    let updated = state.write(|d| {
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
        if let Some(v) = input.priority       { t.priority = v; }
        if let Some(v) = input.notes          { t.notes = v; }
        if let Some(v) = input.tag_ids        { t.tag_ids = v; }
        t.updated_at = now_ms();
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

#[tauri::command]
pub fn set_task_done(id: String, done: bool, state: State<'_, AppState>, app: AppHandle) -> Result<Task> {
    let updated = state.write(|d| {
        let t = d.tasks.iter_mut().find(|t| t.id == id)
            .ok_or_else(|| AppError::NotFound(format!("task {id}")))?;
        t.done = done;
        let ts = now_ms();
        t.completed_at = if done { Some(ts) } else { None };
        t.updated_at = ts;
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

#[derive(Deserialize)]
pub struct NewProjectInput { pub name: String, pub color: String }

#[tauri::command]
pub fn add_project(input: NewProjectInput, state: State<'_, AppState>, app: AppHandle) -> Result<Project> {
    let p = Project { id: new_project_id(), name: input.name, color: input.color };
    let saved = state.write(|d| { d.projects.push(p.clone()); Ok(p) })?;
    emit_changed(&app);
    Ok(saved)
}

#[tauri::command]
pub fn delete_project(id: String, state: State<'_, AppState>, app: AppHandle) -> Result<()> {
    state.write(|d| {
        let before = d.projects.len();
        d.projects.retain(|p| p.id != id);
        if d.projects.len() == before {
            return Err(AppError::NotFound(format!("project {id}")));
        }
        // Cascade: tags pointing at this project become free-floating.
        for t in d.tags.iter_mut() {
            if t.project_id.as_deref() == Some(&id) { t.project_id = None; }
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
    #[serde(default)] pub project_id: Option<String>,
}

#[tauri::command]
pub fn add_tag(input: NewTagInput, state: State<'_, AppState>, app: AppHandle) -> Result<Tag> {
    let t = Tag { id: new_tag_id(), name: input.name, color: input.color, project_id: input.project_id };
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
pub struct UpdateProjectInput {
    pub id:    String,
    #[serde(default)] pub name:  Option<String>,
    #[serde(default)] pub color: Option<String>,
}

#[tauri::command]
pub fn update_project(input: UpdateProjectInput, state: State<'_, AppState>, app: AppHandle) -> Result<crate::model::Project> {
    let updated = state.write(|d| {
        let p = d.projects.iter_mut().find(|p| p.id == input.id)
            .ok_or_else(|| AppError::NotFound(format!("project {}", input.id)))?;
        if let Some(v) = input.name {
            let t = v.trim().to_string();
            if t.is_empty() { return Err(AppError::Invalid("name is empty".into())); }
            p.name = t;
        }
        if let Some(v) = input.color { p.color = v; }
        Ok(p.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

#[derive(Deserialize)]
pub struct UpdateTagInput {
    pub id:    String,
    #[serde(default)] pub name:       Option<String>,
    #[serde(default)] pub color:      Option<String>,
    /// Same Option<Option<T>> serde caveat as UpdateTaskInput — Phase 2 UI
    /// uses the explicit clear_tag_project command to clear instead of sending null.
    #[serde(default)] pub project_id: Option<String>,
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
        if let Some(v) = input.color      { t.color = v; }
        if let Some(v) = input.project_id { t.project_id = Some(v); }
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

/// Explicit "clear the tag's project_id" command — workaround for the serde
/// Option<Option<T>> limitation. Use this instead of trying to send null.
#[tauri::command]
pub fn clear_tag_project(id: String, state: State<'_, AppState>, app: AppHandle) -> Result<crate::model::Tag> {
    let updated = state.write(|d| {
        let t = d.tags.iter_mut().find(|t| t.id == id)
            .ok_or_else(|| AppError::NotFound(format!("tag {id}")))?;
        t.project_id = None;
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

#[derive(Deserialize)]
pub struct UpdateSettingsInput {
    #[serde(default)] pub theme: Option<String>,
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

#[tauri::command]
pub fn read_conflict(conflict_path: String, state: State<'_, AppState>) -> Result<Vec<TaskDiff>> {
    let bytes = std::fs::read(&conflict_path)?;
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
    let bytes = std::fs::read(&input.conflict_path)?;
    let theirs: crate::model::Document = serde_json::from_slice(&bytes)?;
    state.write(|d| {
        d.tasks = apply_decisions(d, &theirs, &input.decisions);
        Ok(())
    })?;
    let _ = std::fs::remove_file(&input.conflict_path);
    emit_changed(&app);
    let path: PathBuf = state.path();
    let _ = app.emit("conflicts-detected", &scan_conflict_files(&path));
    Ok(())
}

#[tauri::command]
pub fn dismiss_conflict(conflict_path: String, app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    let _ = std::fs::remove_file(&conflict_path);
    let path: PathBuf = state.path();
    let _ = app.emit("conflicts-detected", &scan_conflict_files(&path));
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
        assert_eq!(v.priority, None);
    }

    #[test]
    fn update_task_input_null_field_clears() {
        let v: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","due_date":null,"priority":null}"#).unwrap();
        assert_eq!(v.due_date, Some(None));
        assert_eq!(v.priority, Some(None));
    }

    #[test]
    fn update_task_input_value_sets_field() {
        let v: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","due_date":"2026-06-01","priority":"high"}"#).unwrap();
        assert_eq!(v.due_date, Some(Some(NaiveDate::from_ymd_opt(2026, 6, 1).unwrap())));
        assert_eq!(v.priority, Some(Some(Priority::High)));
    }
}
