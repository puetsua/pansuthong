//! Shared task mutations used by Tauri commands and the built-in MCP server.

use crate::commands::{NewTaskInput, UpdateTaskInput};
use crate::error::{AppError, Result};
use crate::model::{new_task_id, now_ms, Attachment, Tag, Task};
use crate::store::AppState;

pub(crate) fn validate_time(t: Option<&str>) -> Result<()> {
    if let Some(s) = t {
        chrono::NaiveTime::parse_from_str(s, "%H:%M")
            .map_err(|_| AppError::Invalid(format!("time must be HH:MM, got {s:?}")))?;
    }
    Ok(())
}

const ESTIMATED_SECONDS_MAX: i64 = 100_000 * 60;

pub(crate) fn validate_estimated_seconds(seconds: Option<i64>) -> Result<()> {
    if let Some(n) = seconds {
        if !(1..=ESTIMATED_SECONDS_MAX).contains(&n) {
            return Err(AppError::Invalid(format!(
                "estimated seconds must be 1..={ESTIMATED_SECONDS_MAX}, got {n}"
            )));
        }
    }
    Ok(())
}

fn validate_attachments(attachments: &[Attachment]) -> Result<()> {
    crate::commands::validate_attachments(attachments)
}

pub(crate) fn retain_known_tags(ids: Vec<String>, tags: &[Tag]) -> Vec<String> {
    crate::commands::retain_known_tags(ids, tags)
}

pub fn add_task_record(state: &AppState, input: NewTaskInput) -> Result<Task> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid("title is empty".into()));
    }
    validate_time(input.due_time.as_deref())?;
    validate_time(input.start_time.as_deref())?;
    validate_estimated_seconds(input.estimated_seconds)?;
    validate_attachments(&input.attachments)?;
    let ts = now_ms();
    state.write(|d| {
        let task = Task {
            id: new_task_id(),
            title,
            due_date: input.due_date,
            due_time: input.due_date.and(input.due_time),
            start_date: input.start_date,
            start_time: input.start_date.and(input.start_time),
            notes: input.notes,
            attachments: input.attachments,
            tag_ids: retain_known_tags(input.tag_ids, &d.tags),
            estimated_seconds: input.estimated_seconds,
            created_at: ts,
            completed_at: None,
            updated_at: ts,
            time_entries: Vec::new(),
        };
        d.tasks.push(task.clone());
        Ok(task)
    })
}

pub fn update_task_record(state: &AppState, input: UpdateTaskInput) -> Result<Task> {
    state.write(|d| {
        let known: std::collections::HashSet<String> =
            d.tags.iter().map(|t| t.id.clone()).collect();
        let idx = d
            .tasks
            .iter()
            .position(|t| t.id == input.id)
            .ok_or_else(|| AppError::NotFound(format!("task {}", input.id)))?;
        let mut next = d.tasks[idx].clone();
        if let Some(v) = input.title {
            let trimmed = v.trim().to_string();
            if trimmed.is_empty() {
                return Err(AppError::Invalid("title is empty".into()));
            }
            next.title = trimmed;
        }
        if let Some(ref v) = input.due_time {
            validate_time(v.as_deref())?;
        }
        if let Some(ref v) = input.start_time {
            validate_time(v.as_deref())?;
        }
        if let Some(v) = input.estimated_seconds {
            validate_estimated_seconds(v)?;
        }
        if let Some(v) = input.due_date {
            next.due_date = v;
        }
        if let Some(v) = input.due_time {
            next.due_time = v;
        }
        if let Some(v) = input.start_date {
            next.start_date = v;
        }
        if let Some(v) = input.start_time {
            next.start_time = v;
        }
        if let Some(v) = input.notes {
            next.notes = v.unwrap_or_default();
        }
        if let Some(v) = input.attachments {
            validate_attachments(&v)?;
            next.attachments = v;
        }
        if let Some(v) = input.tag_ids {
            next.tag_ids = v.into_iter().filter(|id| known.contains(id)).collect();
        }
        if let Some(v) = input.estimated_seconds {
            next.estimated_seconds = v;
        }
        if next.due_date.is_none() {
            next.due_time = None;
        }
        if next.start_date.is_none() {
            next.start_time = None;
        }
        next.updated_at = now_ms();
        d.tasks[idx] = next;
        Ok(d.tasks[idx].clone())
    })
}

pub fn set_task_done_record(state: &AppState, id: &str, done: bool) -> Result<Task> {
    state.write(|d| {
        let t = d
            .tasks
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or_else(|| AppError::NotFound(format!("task {id}")))?;
        if t.done() == done {
            return Ok(t.clone());
        }
        t.set_done(done, now_ms());
        Ok(t.clone())
    })
}

pub fn delete_task_record(state: &AppState, id: &str) -> Result<Vec<String>> {
    let mut orphaned: Vec<String> = Vec::new();
    state.write(|d| {
        let ts = now_ms();
        let before = d.tasks.len();
        if let Some(t) = d.tasks.iter().find(|t| t.id == id) {
            orphaned = t.attachments.iter().map(|a| a.path.clone()).collect();
        }
        d.tasks.retain(|t| t.id != id);
        if d.tasks.len() == before {
            return Err(AppError::NotFound(format!("task {id}")));
        }
        d.deleted_tasks.push(crate::model::Tombstone {
            id: id.to_string(),
            deleted_at: ts,
            deleted_by: None,
        });
        Ok(())
    })?;
    Ok(orphaned)
}

/// Resolve tag names (case-insensitive) to ids; error if any name is unknown.
pub fn resolve_tag_names(
    names: &[String],
    tags: &[Tag],
) -> Result<Vec<String>> {
    let mut out = Vec::with_capacity(names.len());
    for name in names {
        let key = name.trim();
        if key.is_empty() {
            continue;
        }
        let found = tags
            .iter()
            .find(|t| t.name.eq_ignore_ascii_case(key))
            .map(|t| t.id.clone())
            .ok_or_else(|| AppError::Invalid(format!("unknown tag: {key}")))?;
        if !out.contains(&found) {
            out.push(found);
        }
    }
    Ok(out)
}

pub fn estimated_seconds_from_minutes(minutes: Option<i64>) -> Result<Option<i64>> {
    match minutes {
        None => Ok(None),
        Some(m) if m <= 0 => Err(AppError::Invalid("estimated_minutes must be positive".into())),
        Some(m) => Ok(Some(m * 60)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::UpdateTaskInput;
    use crate::history::read_all_history;
    use crate::model::{new_tag_id, new_task_id, Document, Tag, Task};
    use crate::store::AppState;
    use tempfile::tempdir;

    fn store_with(tags: Vec<Tag>, tasks: Vec<Task>) -> AppState {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_test.db");
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
    fn resolve_tag_names_errors_on_unknown() {
        let tag = Tag {
            id: new_tag_id(),
            name: "work".into(),
            color: "#000".into(),
            priority: 0,
            pinned: false,
            updated_at: 0,
            dashboard_view: None,
            dashboard_order: None,
        };
        let err = resolve_tag_names(&["missing".into()], &[tag]).unwrap_err();
        assert!(err.to_string().contains("unknown tag"));
    }

    #[test]
    fn update_task_record_rolls_back_on_validation_error() {
        let task = Task {
            id: new_task_id(),
            title: "before".into(),
            due_date: None,
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
        let id = task.id.clone();
        let state = store_with(vec![], vec![task]);
        let err = update_task_record(
            &state,
            UpdateTaskInput {
                id,
                title: Some("SHOULD-NOT-APPLY".into()),
                due_date: None,
                due_time: Some(Some("99:99".into())),
                start_date: None,
                start_time: None,
                notes: None,
                attachments: None,
                tag_ids: None,
                estimated_seconds: None,
            },
        )
        .unwrap_err();
        assert!(err.to_string().contains("HH:MM"));
        let read = state.read(|d| d.tasks[0].title.clone());
        assert_eq!(read, "before");
    }

    #[test]
    fn complete_task_is_idempotent_when_already_done() {
        let task = Task {
            id: new_task_id(),
            title: "done".into(),
            due_date: None,
            due_time: None,
            start_date: None,
            start_time: None,
            notes: "".into(),
            attachments: vec![],
            tag_ids: vec![],
            estimated_seconds: None,
            created_at: 0,
            completed_at: Some(42),
            updated_at: 1,
            time_entries: vec![],
        };
        let id = task.id.clone();
        let state = store_with(vec![], vec![task]);
        let before_count = read_all_history(&state.path()).unwrap().len();
        let again = set_task_done_record(&state, &id, true).unwrap();
        assert_eq!(again.completed_at, Some(42));
        assert_eq!(again.updated_at, 1);
        let after_count = read_all_history(&state.path()).unwrap().len();
        assert_eq!(before_count, after_count);
    }

    #[test]
    fn delete_task_record_writes_history_tombstone() {
        let task = Task {
            id: new_task_id(),
            title: "gone".into(),
            due_date: None,
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
        let id = task.id.clone();
        let state = store_with(vec![], vec![task]);
        delete_task_record(&state, &id).unwrap();
        let history = read_all_history(&state.path()).unwrap();
        assert!(
            history
                .iter()
                .any(|e| e.entity_id == id && e.event.contains("deleted")),
            "history: {:?}",
            history
        );
    }
}
