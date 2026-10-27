//! Task list filters for MCP — mirrors frontend view membership in `state/indexes.ts`.

use crate::config::Settings;
use crate::logical_day::{add_days_iso, logical_day_of, today_iso};
use crate::model::{Tag, Task};
use crate::store::AppState;
use chrono::{Local, NaiveDate};

#[derive(Debug, Clone, Default)]
pub struct ListTasksQuery {
    pub view: Option<String>,
    pub tag: Option<String>,
    pub due_before: Option<NaiveDate>,
    pub due_after: Option<NaiveDate>,
    pub query: Option<String>,
    pub limit: Option<u32>,
}

const DEFAULT_LIMIT: u32 = 50;

pub fn list_tasks(state: &AppState, settings: &Settings, q: ListTasksQuery) -> Vec<Task> {
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).min(500) as usize;
    state.read(|d| {
        let dsh = settings.day_start_hour;
        let today = today_iso(Local::now(), dsh);
        let horizon = settings.upcoming_days.max(1);

        let tags_by_id: std::collections::HashMap<&str, &Tag> =
            d.tags.iter().map(|t| (t.id.as_str(), t)).collect();
        let tags_by_name: std::collections::HashMap<String, &Tag> = d
            .tags
            .iter()
            .map(|t| (t.name.to_lowercase(), t))
            .collect();

        let view = q.view.as_deref().unwrap_or("all");
        let mut tasks: Vec<Task> = d
            .tasks
            .iter()
            .filter(|t| match view {
                "completed" => t.archived(),
                "all" => !t.archived(),
                _ => !t.archived(),
            })
            .filter(|t| match view {
                "today" => in_today(t, &today, dsh),
                "inbox" => in_inbox(t, &tags_by_id),
                "upcoming" => in_upcoming(t, &today, horizon),
                _ => true,
            })
            .cloned()
            .collect();

        if let Some(name) = &q.tag {
            let key = name.trim().to_lowercase();
            if let Some(tag) = tags_by_name.get(&key) {
                tasks.retain(|t| t.tag_ids.iter().any(|id| id == &tag.id));
            } else {
                tasks.clear();
            }
        }

        if let Some(before) = q.due_before {
            tasks.retain(|t| t.due_date.is_some_and(|d| d <= before));
        }
        if let Some(after) = q.due_after {
            tasks.retain(|t| t.due_date.is_some_and(|d| d >= after));
        }
        if let Some(text) = &q.query {
            let needle = text.to_lowercase();
            tasks.retain(|t| {
                t.title.to_lowercase().contains(&needle)
                    || t.notes.to_lowercase().contains(&needle)
            });
        }

        if tasks.len() > limit {
            tasks.truncate(limit);
        }
        tasks
    })
}

fn in_inbox(t: &Task, tags_by_id: &std::collections::HashMap<&str, &Tag>) -> bool {
    !t.tag_ids.iter().any(|id| tags_by_id.get(id.as_str()).is_some_and(|tag| tag.pinned))
}

fn covers_today(t: &Task, today_iso: &str) -> bool {
    let today = NaiveDate::parse_from_str(today_iso, "%Y-%m-%d").ok();
    let Some(today) = today else {
        return false;
    };
    if let Some(start) = t.start_date {
        return start <= today;
    }
    t.due_date.is_some_and(|d| d <= today)
}

fn ms_to_local_iso(ms: i64) -> String {
    use chrono::{Local, SecondsFormat, TimeZone};
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|dt| dt.to_rfc3339_opts(SecondsFormat::Secs, false))
        .unwrap_or_else(|| ms.to_string())
}

fn tracked_today(t: &Task, today_iso: &str, dsh: u32) -> bool {
    t.time_entries.iter().any(|e| {
        if e.end.is_none() {
            return true;
        }
        let start_day = logical_day_of(&ms_to_local_iso(e.start), dsh);
        let end_day = e
            .end
            .map(|end| logical_day_of(&ms_to_local_iso(end), dsh))
            .unwrap_or_default();
        start_day == today_iso || end_day == today_iso
    })
}

fn in_today(t: &Task, today_iso: &str, dsh: u32) -> bool {
    if t.archived() {
        let completed = t
            .completed_at
            .map(|ms| logical_day_of(&ms_to_local_iso(ms), dsh))
            .unwrap_or_default();
        if completed != today_iso {
            return false;
        }
    }
    covers_today(t, today_iso) || tracked_today(t, today_iso, dsh)
}

fn on_day(t: &Task, iso: &str) -> bool {
    t.start_date.is_some_and(|d| d.to_string() == iso)
        || t.due_date.is_some_and(|d| d.to_string() == iso)
}

fn in_upcoming(t: &Task, today_iso: &str, horizon: u32) -> bool {
    for i in 1..=horizon {
        let iso = add_days_iso(today_iso, i as i32);
        if on_day(t, &iso) {
            return true;
        }
    }
    false
}

pub fn get_task(state: &AppState, id: &str) -> Option<Task> {
    state.read(|d| d.tasks.iter().find(|t| t.id == id).cloned())
}

pub fn list_tags(state: &AppState) -> Vec<Tag> {
    state.read(|d| d.tags.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Settings;
    use crate::model::{new_task_id, new_tag_id, Document, Tag, Task};
    use crate::store::AppState;
    use chrono::NaiveDate;
    use tempfile::tempdir;

    fn open_store(tasks: Vec<Task>, tags: Vec<Tag>) -> AppState {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        let state = AppState::open_in_memory("test-device", path).unwrap();
        state
            .write(|d| {
                *d = Document {
                    version: 9,
                    last_modified: 0,
                    tags,
                    tasks,
                    template_tasks: vec![],
                    deleted_tasks: vec![],
                    deleted_tags: vec![],
                    deleted_template_tasks: vec![],
                    deleted_attachments: vec![],
                };
                Ok(())
            })
            .unwrap();
        state
    }

    #[test]
    fn unknown_tag_name_yields_empty_list() {
        let state = open_store(vec![], vec![]);
        let settings = Settings::default();
        let out = list_tasks(
            &state,
            &settings,
            ListTasksQuery {
                tag: Some("nope".into()),
                ..Default::default()
            },
        );
        assert!(out.is_empty());
    }

    #[test]
    fn inbox_excludes_pinned_tag_tasks() {
        let tag = Tag {
            id: new_tag_id(),
            name: "work".into(),
            color: "#000".into(),
            priority: 0,
            pinned: true,
            updated_at: 0,
            dashboard_view: None,
            dashboard_order: None,
        };
        let task = Task {
            id: new_task_id(),
            title: "t".into(),
            due_date: None,
            due_time: None,
            start_date: None,
            start_time: None,
            notes: "".into(),
            attachments: vec![],
            tag_ids: vec![tag.id.clone()],
            estimated_seconds: None,
            created_at: 0,
            completed_at: None,
            updated_at: 0,
            time_entries: vec![],
        };
        let state = open_store(vec![task], vec![tag]);
        let settings = Settings::default();
        let inbox = list_tasks(
            &state,
            &settings,
            ListTasksQuery {
                view: Some("inbox".into()),
                ..Default::default()
            },
        );
        assert!(inbox.is_empty());
    }

    #[test]
    fn upcoming_includes_task_on_future_due_day() {
        let today = today_iso(Local::now(), 0);
        let due = add_days_iso(&today, 2);
        let due_date = NaiveDate::parse_from_str(&due, "%Y-%m-%d").unwrap();
        let task = Task {
            id: new_task_id(),
            title: "future".into(),
            due_date: Some(due_date),
            due_time: None,
            start_date: None,
            start_time: None,
            notes: "".into(),
            attachments: vec![],
            tag_ids: vec![],
            estimated_seconds: None,
            created_at: 0,
            completed_at: None,
            updated_at: 0,
            time_entries: vec![],
        };
        let state = open_store(vec![task], vec![]);
        let settings = Settings::default();
        let out = list_tasks(
            &state,
            &settings,
            ListTasksQuery {
                view: Some("upcoming".into()),
                ..Default::default()
            },
        );
        assert_eq!(out.len(), 1);
    }
}
