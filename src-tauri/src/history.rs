use crate::error::Result;
use crate::model::{Document, Tag, Task, TemplateTask};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryEntry {
    #[serde(with = "crate::model::iso_secs")]
    pub timestamp: i64,
    pub event: String,
    pub entity: String,
    pub entity_id: String,
    pub title: String,
    pub summary: String,
}

pub fn history_path(data_path: &Path) -> PathBuf {
    data_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("history.jsonl")
}

pub fn read_history(data_path: &Path, limit: usize) -> Result<Vec<HistoryEntry>> {
    let path = history_path(data_path);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let file = fs::File::open(path)?;
    let reader = BufReader::new(file);
    let mut entries = Vec::new();
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<HistoryEntry>(&line) {
            entries.push(entry);
        }
    }
    entries.reverse();
    entries.truncate(limit);
    Ok(entries)
}

pub fn append_history(data_path: &Path, entries: &[HistoryEntry]) -> Result<()> {
    if entries.is_empty() {
        return Ok(());
    }
    let path = history_path(data_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    for entry in entries {
        serde_json::to_writer(&mut file, entry)?;
        file.write_all(b"\n")?;
    }
    file.flush()?;
    Ok(())
}

pub fn entries_for_change(
    before: &Document,
    after: &Document,
    timestamp: i64,
) -> Vec<HistoryEntry> {
    let mut entries = Vec::new();
    entries.extend(diff_tasks(&before.tasks, &after.tasks, timestamp));
    entries.extend(diff_tags(&before.tags, &after.tags, timestamp));
    entries.extend(diff_templates(
        &before.template_tasks,
        &after.template_tasks,
        timestamp,
    ));
    entries
}

fn diff_tasks(before: &[Task], after: &[Task], timestamp: i64) -> Vec<HistoryEntry> {
    diff_entities(
        before,
        after,
        timestamp,
        EntityHistory {
            entity: "task",
            id: task_id,
            title: task_title,
            update_kind: task_update_kind,
            created: ("task.created", "Created task"),
            deleted: ("task.deleted", "Deleted task"),
        },
    )
}

fn diff_tags(before: &[Tag], after: &[Tag], timestamp: i64) -> Vec<HistoryEntry> {
    diff_entities(
        before,
        after,
        timestamp,
        EntityHistory {
            entity: "tag",
            id: tag_id,
            title: tag_title,
            update_kind: tag_update_kind,
            created: ("tag.created", "Created tag"),
            deleted: ("tag.deleted", "Deleted tag"),
        },
    )
}

fn diff_templates(
    before: &[TemplateTask],
    after: &[TemplateTask],
    timestamp: i64,
) -> Vec<HistoryEntry> {
    diff_entities(
        before,
        after,
        timestamp,
        EntityHistory {
            entity: "template",
            id: template_id,
            title: template_title,
            update_kind: template_update_kind,
            created: ("template.created", "Created template"),
            deleted: ("template.deleted", "Deleted template"),
        },
    )
}

fn diff_entities<T>(
    before: &[T],
    after: &[T],
    timestamp: i64,
    history: EntityHistory<T>,
) -> Vec<HistoryEntry>
where
    T: Serialize,
{
    let before_map = before
        .iter()
        .map(|item| ((history.id)(item), item))
        .collect::<HashMap<_, _>>();
    let after_map = after
        .iter()
        .map(|item| ((history.id)(item), item))
        .collect::<HashMap<_, _>>();
    let ids = before_map
        .keys()
        .chain(after_map.keys())
        .copied()
        .collect::<BTreeSet<_>>();

    let mut entries = Vec::new();
    for entity_id in ids {
        match (before_map.get(entity_id), after_map.get(entity_id)) {
            (None, Some(new)) => entries.push(entry(
                timestamp,
                history.created.0,
                history.entity,
                entity_id,
                (history.title)(new),
                history.created.1,
            )),
            (Some(old), None) => entries.push(entry(
                timestamp,
                history.deleted.0,
                history.entity,
                entity_id,
                (history.title)(old),
                history.deleted.1,
            )),
            (Some(old), Some(new)) if to_value(old) != to_value(new) => {
                let (event, summary) = (history.update_kind)(old, new);
                entries.push(entry(
                    timestamp,
                    event,
                    history.entity,
                    entity_id,
                    (history.title)(new),
                    summary,
                ));
            }
            _ => {}
        }
    }
    entries
}

fn entry(
    timestamp: i64,
    event: &str,
    entity: &str,
    entity_id: &str,
    title: String,
    summary: &str,
) -> HistoryEntry {
    HistoryEntry {
        timestamp,
        event: event.to_string(),
        entity: entity.to_string(),
        entity_id: entity_id.to_string(),
        title,
        summary: summary.to_string(),
    }
}

fn to_value<T: Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).unwrap_or(serde_json::Value::Null)
}

fn task_id(t: &Task) -> &str {
    &t.id
}
fn task_title(t: &Task) -> String {
    t.title.clone()
}
fn tag_id(t: &Tag) -> &str {
    &t.id
}
fn tag_title(t: &Tag) -> String {
    format!("#{}", t.name)
}
fn template_id(t: &TemplateTask) -> &str {
    &t.id
}
fn template_title(t: &TemplateTask) -> String {
    t.title.clone()
}

type UpdateKind<T> = fn(&T, &T) -> (&'static str, &'static str);

struct EntityHistory<T> {
    entity: &'static str,
    id: fn(&T) -> &str,
    title: fn(&T) -> String,
    update_kind: UpdateKind<T>,
    created: (&'static str, &'static str),
    deleted: (&'static str, &'static str),
}

fn task_update_kind(old: &Task, new: &Task) -> (&'static str, &'static str) {
    if old.completed_at.is_none() && new.completed_at.is_some() {
        ("task.completed", "Completed task")
    } else if old.completed_at.is_some() && new.completed_at.is_none() {
        ("task.reopened", "Reopened task")
    } else {
        ("task.updated", "Updated task")
    }
}

fn tag_update_kind(_old: &Tag, _new: &Tag) -> (&'static str, &'static str) {
    ("tag.updated", "Updated tag")
}

fn template_update_kind(_old: &TemplateTask, _new: &TemplateTask) -> (&'static str, &'static str) {
    ("template.updated", "Updated template")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Tag, Task};
    use chrono::NaiveDate;
    use tempfile::tempdir;

    fn task(id: &str, title: &str) -> Task {
        Task {
            id: id.into(),
            title: title.into(),
            due_date: None,
            due_time: None,
            start_date: None,
            start_time: None,
            notes: String::new(),
            tag_ids: Vec::new(),
            created_at: 0,
            completed_at: None,
            updated_at: 0,
            time_entries: Vec::new(),
        }
    }

    #[test]
    fn derives_task_lifecycle_entries() {
        let mut before = Document::default();
        before.tasks.push(task("k_1", "Buy milk"));

        let mut after = before.clone();
        after.tasks[0].completed_at = Some(1_000);
        after.tasks.push(task("k_2", "Call mom"));

        let entries = entries_for_change(&before, &after, 2_000);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].event, "task.completed");
        assert_eq!(entries[0].title, "Buy milk");
        assert_eq!(entries[1].event, "task.created");
        assert_eq!(entries[1].title, "Call mom");
    }

    #[test]
    fn derives_tag_and_date_task_updates() {
        let mut before = Document::default();
        before.tags.push(Tag {
            id: "t_1".into(),
            name: "work".into(),
            color: "#000000".into(),
            priority: 0,
            pinned: false,
        });
        before.tasks.push(task("k_1", "Ship"));

        let mut after = before.clone();
        after.tags[0].pinned = true;
        after.tasks[0].due_date = NaiveDate::from_ymd_opt(2026, 6, 4);

        let entries = entries_for_change(&before, &after, 3_000);
        assert_eq!(
            entries.iter().map(|e| e.event.as_str()).collect::<Vec<_>>(),
            ["task.updated", "tag.updated",]
        );
    }

    #[test]
    fn reads_newest_entries_first() {
        let dir = tempdir().unwrap();
        let data = dir.path().join("tasks.json");
        append_history(
            &data,
            &[
                entry(
                    1_000,
                    "task.created",
                    "task",
                    "k_1",
                    "One".into(),
                    "Created task",
                ),
                entry(
                    2_000,
                    "task.created",
                    "task",
                    "k_2",
                    "Two".into(),
                    "Created task",
                ),
            ],
        )
        .unwrap();

        let entries = read_history(&data, 1).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].entity_id, "k_2");
    }
}
