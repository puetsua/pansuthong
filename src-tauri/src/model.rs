use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Shortened uuid (12 hex chars) with a type prefix. Stable across devices.
fn short_id(prefix: &str) -> String {
    let hex = Uuid::new_v4().simple().to_string();
    format!("{prefix}_{}", &hex[..12])
}

pub fn new_task_id()    -> String { short_id("k") }
pub fn new_tag_id()     -> String { short_id("t") }

/// Epoch milliseconds. Used for created_at/updated_at/last_modified. UTC-based,
/// so it's stable across devices and timezone changes.
pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub theme: String,        // "auto" | "light" | "dark"
    /// Task list ordering: "priority" (weight desc, then date) or "date".
    /// `#[serde(default)]` = "priority" for files written before this field existed.
    #[serde(default = "default_sort_order")]
    pub sort_order: String,
}

fn default_sort_order() -> String {
    "priority".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "auto".into(),
            sort_order: default_sort_order(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id:    String,
    pub name:  String,
    pub color: String,
    /// Priority weight. A task's effective priority is the max weight among its
    /// tags (0 if it has none). `#[serde(default)]` = 0 for tags written before
    /// this field existed. Range enforced by the UI to -9999..=9999.
    #[serde(default)]
    pub priority: i64,
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

const CURRENT_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub version:  u32,
    /// Epoch millis of the last edit to the document (any task/tag/setting
    /// change). Bumped by `AppState::write`. Shown as "Last synced"; identical on
    /// all devices when in sync. `#[serde(default)]` = 0 for pre-existing files.
    #[serde(default)]
    pub last_modified: i64,
    #[serde(default)]
    pub settings: Settings,
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
            tags:     Vec::new(),
            tasks:    Vec::new(),
        }
    }
}

impl Document {
    /// True if the task is in Inbox (has no tags).
    pub fn task_in_inbox(&self, task: &Task) -> bool {
        task.tag_ids.is_empty()
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

    pub fn tasks_for_tag(&self, tag_id: &str) -> Vec<&Task> {
        self.tasks.iter().filter(|t| t.tag_ids.iter().any(|id| id == tag_id)).collect()
    }
}
