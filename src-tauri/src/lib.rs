use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub done: bool,
    pub created_at: i64,
}

#[derive(Default)]
struct AppState {
    tasks: Mutex<Vec<Task>>,
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
    Ok(dir.join("tasks.json"))
}

fn load_from_disk(app: &AppHandle) -> Vec<Task> {
    match store_path(app).and_then(|p| {
        if p.exists() {
            fs::read_to_string(&p).map_err(|e| format!("read: {e}"))
        } else {
            Ok(String::from("[]"))
        }
    }) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save_to_disk(app: &AppHandle, tasks: &[Task]) -> Result<(), String> {
    let p = store_path(app)?;
    let json = serde_json::to_string_pretty(tasks).map_err(|e| format!("serialize: {e}"))?;
    fs::write(&p, json).map_err(|e| format!("write: {e}"))
}

#[tauri::command]
fn list_tasks(state: State<'_, AppState>) -> Vec<Task> {
    state.tasks.lock().unwrap().clone()
}

#[tauri::command]
fn add_task(title: String, app: AppHandle, state: State<'_, AppState>) -> Result<Task, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("title is empty".into());
    }
    let task = Task {
        id: uuid_like(),
        title,
        done: false,
        created_at: now_millis(),
    };
    let mut guard = state.tasks.lock().unwrap();
    guard.push(task.clone());
    save_to_disk(&app, &guard)?;
    Ok(task)
}

#[tauri::command]
fn toggle_task(id: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.tasks.lock().unwrap();
    let t = guard.iter_mut().find(|t| t.id == id).ok_or("not found")?;
    t.done = !t.done;
    save_to_disk(&app, &guard)
}

#[tauri::command]
fn delete_task(id: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.tasks.lock().unwrap();
    let before = guard.len();
    guard.retain(|t| t.id != id);
    if guard.len() == before {
        return Err("not found".into());
    }
    save_to_disk(&app, &guard)
}

fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let initial = load_from_disk(&app.handle());
            app.manage(AppState {
                tasks: Mutex::new(initial),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_tasks,
            add_task,
            toggle_task,
            delete_task
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
