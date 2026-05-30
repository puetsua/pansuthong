use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Low,
    Med,
    High,
}

/// Shortened uuid (12 hex chars) with a type prefix. Stable across devices.
fn short_id(prefix: &str) -> String {
    let hex = Uuid::new_v4().simple().to_string();
    format!("{prefix}_{}", &hex[..12])
}

pub fn new_task_id()    -> String { short_id("k") }
pub fn new_project_id() -> String { short_id("p") }
pub fn new_tag_id()     -> String { short_id("t") }

/// Epoch milliseconds. Used for created_at/updated_at/last_modified. UTC-based,
/// so it's stable across devices and timezone changes.
pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub data_file: Option<String>,
    pub theme: String,        // "auto" | "light" | "dark"
    pub device_id: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            data_file: None,
            theme: "auto".into(),
            device_id: short_id("d"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id:    String,
    pub name:  String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id:    String,
    pub name:  String,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id:    String,
    pub title: String,
    pub done:  bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub due_date: Option<NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub scheduled_date: Option<NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub priority: Option<Priority>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    pub created_at:   i64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub completed_at: Option<i64>,
    /// Epoch millis of the last edit to this task. `#[serde(default)]` = 0 for
    /// tasks written before this field existed (UI falls back to created_at).
    #[serde(default)]
    pub updated_at:   i64,
}

const CURRENT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub version:  u32,
    /// Epoch millis of the last edit to the document (any task/project/tag/setting
    /// change). Bumped by `AppState::write`. Shown as "Last synced"; identical on
    /// all devices when in sync. `#[serde(default)]` = 0 for pre-existing files.
    #[serde(default)]
    pub last_modified: i64,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub tags:     Vec<Tag>,
    #[serde(default)]
    pub tasks:    Vec<Task>,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            version:  CURRENT_VERSION,
            last_modified: 0,
            settings: Settings::default(),
            projects: Vec::new(),
            tags:     Vec::new(),
            tasks:    Vec::new(),
        }
    }
}

use std::collections::HashMap;

impl Document {
    /// Tag id → its (optional) project id.
    pub fn tag_to_project(&self) -> HashMap<&str, &str> {
        self.tags.iter()
            .filter_map(|t| t.project_id.as_deref().map(|p| (t.id.as_str(), p)))
            .collect()
    }

    /// True if the task should appear in project P.
    pub fn task_in_project(&self, task: &Task, project_id: &str) -> bool {
        let m = self.tag_to_project();
        task.tag_ids.iter().any(|tid| m.get(tid.as_str()) == Some(&project_id))
    }

    /// True if the task is in Inbox (no project-linked tag).
    pub fn task_in_inbox(&self, task: &Task) -> bool {
        let m = self.tag_to_project();
        task.tag_ids.iter().all(|tid| !m.contains_key(tid.as_str()))
    }

    /// Today: scheduled today, OR (due < today AND !done), OR due == today.
    pub fn tasks_today(&self, today: NaiveDate) -> Vec<&Task> {
        self.tasks.iter().filter(|t| {
            if t.scheduled_date == Some(today) { return true; }
            if let Some(due) = t.due_date {
                if due == today { return true; }
                if due < today && !t.done { return true; }
            }
            false
        }).collect()
    }

    pub fn tasks_inbox(&self) -> Vec<&Task> {
        self.tasks.iter().filter(|t| self.task_in_inbox(t)).collect()
    }

    pub fn tasks_for_project(&self, project_id: &str) -> Vec<&Task> {
        self.tasks.iter().filter(|t| self.task_in_project(t, project_id)).collect()
    }

    pub fn tasks_for_tag(&self, tag_id: &str) -> Vec<&Task> {
        self.tasks.iter().filter(|t| t.tag_ids.iter().any(|id| id == tag_id)).collect()
    }
}
