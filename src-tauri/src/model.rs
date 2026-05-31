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
    /// Archived tasks are non-destructively removed from the active views
    /// (Today / Inbox / tag / Upcoming) but remain recoverable and searchable.
    /// `#[serde(default)]` = false for tasks written before this field existed.
    #[serde(default)]
    pub archived: bool,
    /// Epoch millis the task was archived; cleared on unarchive.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub archived_at: Option<i64>,
}

pub const CURRENT_VERSION: u32 = 2;

/// Files written before `version` existed are assumed compatible with the
/// current schema (the model is additive/backward-compatible), so an absent
/// key loads as `CURRENT_VERSION` rather than 0 (which would downgrade the file
/// on the next write).
fn default_version() -> u32 {
    CURRENT_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    #[serde(default = "default_version")]
    pub version:  u32,
    /// Epoch millis of the last edit to the document (any task/tag change).
    /// Bumped by `AppState::write`. Shown as "Last synced"; identical on all
    /// devices when in sync. `#[serde(default)]` = 0 for pre-existing files.
    #[serde(default)]
    pub last_modified: i64,
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
            tags:     Vec::new(),
            tasks:    Vec::new(),
        }
    }
}

impl Task {
    /// Toggle completion. Finishing a task also archives it (sweeping it out of
    /// the active Today/Inbox/tag views); reopening it clears the archive. Keeping
    /// `done` and `archived` in lockstep is what makes "done" send a task to the
    /// archive and un-checking it bring the task back.
    pub fn set_done(&mut self, done: bool, ts: i64) {
        self.done = done;
        self.completed_at = if done { Some(ts) } else { None };
        self.archived = done;
        self.archived_at = if done { Some(ts) } else { None };
        self.updated_at = ts;
    }
}

impl Document {
    /// True if the task is in Inbox (has no tags).
    pub fn task_in_inbox(&self, task: &Task) -> bool {
        task.tag_ids.is_empty()
    }

    /// Today: scheduled today, OR (due < today AND !done), OR due == today.
    /// Archived tasks never appear in active views.
    pub fn tasks_today(&self, today: NaiveDate) -> Vec<&Task> {
        self.tasks.iter().filter(|t| {
            if t.archived { return false; }
            if t.scheduled_date == Some(today) { return true; }
            if let Some(due) = t.due_date {
                if due == today { return true; }
                if due < today && !t.done { return true; }
            }
            false
        }).collect()
    }

    pub fn tasks_inbox(&self) -> Vec<&Task> {
        self.tasks.iter().filter(|t| !t.archived && self.task_in_inbox(t)).collect()
    }

    pub fn tasks_for_tag(&self, tag_id: &str) -> Vec<&Task> {
        self.tasks.iter()
            .filter(|t| !t.archived && t.tag_ids.iter().any(|id| id == tag_id))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task() -> Task {
        Task {
            id: "k_1".into(),
            title: "t".into(),
            done: false,
            due_date: None,
            scheduled_date: None,
            notes: String::new(),
            tag_ids: Vec::new(),
            created_at: 0,
            completed_at: None,
            updated_at: 0,
            archived: false,
            archived_at: None,
        }
    }

    #[test]
    fn completing_a_task_archives_it() {
        let mut t = task();
        t.set_done(true, 100);
        assert!(t.done);
        assert_eq!(t.completed_at, Some(100));
        assert!(t.archived, "finishing a task sends it to the archive");
        assert_eq!(t.archived_at, Some(100));
        assert_eq!(t.updated_at, 100);
    }

    #[test]
    fn uncompleting_a_task_unarchives_it() {
        let mut t = task();
        t.set_done(true, 100);
        t.set_done(false, 200);
        assert!(!t.done);
        assert_eq!(t.completed_at, None);
        assert!(!t.archived, "reopening a task restores it to the active views");
        assert_eq!(t.archived_at, None);
        assert_eq!(t.updated_at, 200);
    }
}
