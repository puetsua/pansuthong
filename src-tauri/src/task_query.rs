//! Task list filters for MCP — mirrors frontend view membership in `state/indexes.ts`.

use crate::config::Settings;
use crate::error::{AppError, Result};
use crate::logical_day::{add_days_iso, logical_day_of, today_iso};
use crate::model::{Tag, Task};
use crate::store::AppState;
use chrono::{Local, NaiveDate};

/// `list_tasks` view parameter values accepted by the MCP tool and query layer.
pub const LIST_TASK_VIEWS: &[&str] =
    &["today", "inbox", "upcoming", "completed", "all"];

/// Default and maximum page size for `list_tasks` when `limit` is omitted or above the cap.
pub const LIST_TASKS_DEFAULT_LIMIT: u32 = 500;

/// Validate an optional view name; `None` means `all`.
pub fn validate_list_view(view: Option<&str>) -> Result<&'static str> {
    match view {
        None => Ok("all"),
        Some(v) => match v {
            "today" => Ok("today"),
            "inbox" => Ok("inbox"),
            "upcoming" => Ok("upcoming"),
            "completed" => Ok("completed"),
            "all" => Ok("all"),
            _ => Err(AppError::Invalid(format!(
                "invalid view \"{v}\". Valid views: {}",
                LIST_TASK_VIEWS.join(", ")
            ))),
        },
    }
}

#[derive(Debug, Clone, Default)]
pub struct ListTasksQuery {
    pub view: Option<String>,
    pub tag: Option<String>,
    pub due_before: Option<NaiveDate>,
    pub due_after: Option<NaiveDate>,
    pub query: Option<String>,
    /// Maximum rows to return. When omitted, [`LIST_TASKS_DEFAULT_LIMIT`] applies.
    pub limit: Option<u32>,
    /// Skip this many matching rows before applying `limit`.
    pub offset: Option<u32>,
}

pub struct ListTasksResult {
    pub tasks: Vec<Task>,
    /// True when more tasks matched than returned.
    pub truncated: bool,
}

pub fn list_tasks(state: &AppState, settings: &Settings, q: ListTasksQuery) -> Result<ListTasksResult> {
    let view = validate_list_view(q.view.as_deref())?;
    let offset = q.offset.unwrap_or(0) as usize;
    if q.limit == Some(0) {
        return Err(AppError::Invalid("limit must be at least 1".into()));
    }
    let limit = q
        .limit
        .unwrap_or(LIST_TASKS_DEFAULT_LIMIT)
        .min(LIST_TASKS_DEFAULT_LIMIT) as usize;
    Ok(state.read(|d| {
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

        let truncated = tasks.len() > offset + limit;
        if offset > 0 {
            if offset >= tasks.len() {
                tasks.clear();
            } else {
                tasks = tasks.into_iter().skip(offset).collect();
            }
        }
        tasks.truncate(limit);
        ListTasksResult { tasks, truncated }
    }))
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
