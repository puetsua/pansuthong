use crate::error::{AppError, Result};
use crate::model::{new_project_id, new_tag_id, new_task_id, Document, Priority, Project, Tag, Task};
use crate::parse::{parse as parse_input, ParsedInput};
use crate::search::search as search_doc;
use crate::store::AppState;
use chrono::{Local, NaiveDate};
use serde::Deserialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

const STORE_CHANGED: &str = "store-changed";

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn emit_changed(app: &AppHandle) {
    let _ = app.emit(STORE_CHANGED, ());
}

#[tauri::command]
pub fn get_document(state: State<'_, AppState>) -> Document {
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
    let task = Task {
        id: new_task_id(),
        title,
        done: false,
        due_date: input.due_date,
        scheduled_date: input.scheduled_date,
        priority: input.priority,
        notes: input.notes,
        tag_ids: input.tag_ids,
        created_at: now_ms(),
        completed_at: None,
    };
    let saved = state.write(|d| { d.tasks.push(task.clone()); Ok(task) })?;
    emit_changed(&app);
    Ok(saved)
}

// NOTE (Phase 2): The double-Option fields (due_date, scheduled_date, priority) are
// intended to distinguish "field absent (don't change)" from "field is null (clear it)".
// With default serde_json, this does NOT work — `{}` and `{"due_date": null}` both
// deserialize to None. Phase 1 UI never exercises the "clear an existing optional
// field" path (it only adds/toggles/deletes), so the bug is latent. When the Phase 2
// task-edit UI lands, fix this by adding `serde_with` and using `#[serde_as]` with
// `Option<Option<_>>`, or by switching to explicit `clear_<field>: bool` fields.
#[derive(Deserialize)]
pub struct UpdateTaskInput {
    pub id: String,
    #[serde(default)] pub title: Option<String>,
    #[serde(default)] pub due_date: Option<Option<NaiveDate>>,
    #[serde(default)] pub scheduled_date: Option<Option<NaiveDate>>,
    #[serde(default)] pub priority: Option<Option<Priority>>,
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
        t.completed_at = if done { Some(now_ms()) } else { None };
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
