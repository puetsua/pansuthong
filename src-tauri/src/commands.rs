use crate::error::{AppError, Result};
use crate::model::{new_project_id, new_tag_id, new_task_id, Document, Priority, Project, Tag, Task};
use crate::store::AppState;
use chrono::NaiveDate;
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
        if let Some(v) = input.title          { t.title = v; }
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
