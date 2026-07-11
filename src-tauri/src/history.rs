use crate::error::Result;
use crate::model::{Document, Tag, Task, TemplateTask};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io::{BufRead, BufReader};
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
    let file_name = data_path
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| {
            name.strip_prefix("tasks_").and_then(|rest| {
                rest.strip_suffix(".db")
                    .or_else(|| rest.strip_suffix(".json"))
                    .map(|device| format!("history_{device}.jsonl"))
            })
        })
        .unwrap_or_else(|| "history.jsonl".to_string());
    data_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(file_name)
}

fn legacy_history_path(data_path: &Path) -> PathBuf {
    data_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("history.jsonl")
}

fn history_replica_paths(data_path: &Path) -> Vec<PathBuf> {
    let parent = data_path.parent().unwrap_or_else(|| Path::new("."));
    let mut paths = Vec::new();
    let legacy = legacy_history_path(data_path);
    if legacy.exists() {
        paths.push(legacy);
    }
    if let Ok(entries) = fs::read_dir(parent) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("history_") && name.ends_with(".jsonl") {
                paths.push(entry.path());
            }
        }
    }
    paths.sort();
    paths.dedup();
    paths
}

pub fn read_history(data_path: &Path, limit: usize) -> Result<Vec<HistoryEntry>> {
    let mut entries = Vec::new();
    for path in history_replica_paths(data_path) {
        let file = fs::File::open(path)?;
        let reader = BufReader::new(file);
        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<HistoryEntry>(&line) {
                Ok(entry) => entries.push(entry),
                // A torn/partial last line from an older non-atomic append is
                // skipped so one bad line cannot poison the whole history view.
                Err(e) => eprintln!("warning: skipping unparseable history line: {e}"),
            }
        }
    }
    entries.sort_by(|a, b| {
        b.timestamp
            .cmp(&a.timestamp)
            .then_with(|| b.entity.cmp(&a.entity))
            .then_with(|| b.entity_id.cmp(&a.entity_id))
            .then_with(|| b.event.cmp(&a.event))
    });
    entries.truncate(limit);
    Ok(entries)
}

pub fn read_all_history(data_path: &Path) -> Result<Vec<HistoryEntry>> {
    read_history(data_path, usize::MAX)
}

pub fn append_history(data_path: &Path, entries: &[HistoryEntry]) -> Result<()> {
    if entries.is_empty() {
        return Ok(());
    }
    let path = history_path(data_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    // Rebuild the sidecar and replace atomically so a crash mid-append cannot
    // tear the last line of a previously durable file (at worst the in-flight
    // batch is lost).
    let mut bytes = if path.exists() {
        fs::read(&path)?
    } else {
        Vec::new()
    };
    if !bytes.is_empty() && !bytes.ends_with(b"\n") {
        bytes.push(b'\n');
    }
    for entry in entries {
        serde_json::to_writer(&mut bytes, entry)?;
        bytes.push(b'\n');
    }
    crate::store::atomic_write(&path, &bytes)
}

/// Copy this device's history sidecar(s) when seeding an empty data folder.
///
/// Used by `AppState::repoint` so relocating the sync folder keeps History
/// continuous. Copies the per-device `history_<device>.jsonl` when present, and
/// the legacy `history.jsonl` when that is what the old folder still has.
/// Peer history replicas are left behind — same as peer task replicas, which
/// `repoint` also does not seed. No-op when `from` and `to` share a parent.
pub fn copy_own_history(from_data_path: &Path, to_data_path: &Path) -> Result<()> {
    let from_parent = from_data_path.parent().unwrap_or_else(|| Path::new("."));
    let to_parent = to_data_path.parent().unwrap_or_else(|| Path::new("."));
    if from_parent == to_parent {
        return Ok(());
    }
    fs::create_dir_all(to_parent)?;

    let from_own = history_path(from_data_path);
    let to_own = history_path(to_data_path);
    if from_own.exists() {
        fs::copy(&from_own, &to_own)?;
    }

    let from_legacy = legacy_history_path(from_data_path);
    let to_legacy = legacy_history_path(to_data_path);
    // Only copy legacy when it is a distinct file (not the same path we already
    // handled as the "own" sidecar for a non-device-named data file).
    if from_legacy.exists() && from_legacy != from_own {
        fs::copy(&from_legacy, &to_legacy)?;
    }
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
            attachments: Vec::new(),
            tag_ids: Vec::new(),
            estimated_seconds: None,
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
            updated_at: 1,
            dashboard_view: None,
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

    #[test]
    fn device_replica_history_path_matches_task_replica() {
        let dir = tempdir().unwrap();
        for name in ["tasks_desktop.json", "tasks_desktop.db"] {
            let data = dir.path().join(name);
            append_history(
                &data,
                &[entry(
                    1_000,
                    "task.created",
                    "task",
                    "k_1",
                    "One".into(),
                    "Created task",
                )],
            )
            .unwrap();

            assert!(
                dir.path().join("history_desktop.jsonl").exists(),
                "expected per-device history for {name}"
            );
            assert!(
                !dir.path().join("history.jsonl").exists(),
                "must not fall back to legacy history.jsonl for {name}"
            );
        }
    }

    #[test]
    fn reads_merged_history_replicas_newest_first() {
        let dir = tempdir().unwrap();
        let data = dir.path().join("tasks_desktop.json");
        append_history(
            &data,
            &[entry(
                1_000,
                "task.created",
                "task",
                "k_desktop",
                "Desktop".into(),
                "Created task",
            )],
        )
        .unwrap();

        let mobile_history = dir.path().join("history_mobile.jsonl");
        let mut line = Vec::new();
        serde_json::to_writer(
            &mut line,
            &entry(
                2_000,
                "task.created",
                "task",
                "k_mobile",
                "Mobile".into(),
                "Created task",
            ),
        )
        .unwrap();
        line.push(b'\n');
        fs::write(mobile_history, line).unwrap();

        let entries = read_history(&data, 10).unwrap();
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.entity_id.as_str())
                .collect::<Vec<_>>(),
            ["k_mobile", "k_desktop"]
        );
    }

    #[test]
    fn copy_own_history_copies_device_sidecar_to_new_folder() {
        let from_dir = tempdir().unwrap();
        let to_dir = tempdir().unwrap();
        let from = from_dir.path().join("tasks_dev.db");
        let to = to_dir.path().join("tasks_dev.db");
        append_history(
            &from,
            &[entry(
                1_000,
                "task.created",
                "task",
                "k_1",
                "One".into(),
                "Created task",
            )],
        )
        .unwrap();

        copy_own_history(&from, &to).unwrap();

        assert!(to_dir.path().join("history_dev.jsonl").exists());
        assert!(from_dir.path().join("history_dev.jsonl").exists());
        let entries = read_all_history(&to).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].entity_id, "k_1");
    }

    #[test]
    fn copy_own_history_copies_legacy_sidecar_when_present() {
        let from_dir = tempdir().unwrap();
        let to_dir = tempdir().unwrap();
        let from = from_dir.path().join("tasks_dev.db");
        let to = to_dir.path().join("tasks_dev.db");
        // Legacy-only folder (pre per-device history).
        fs::write(
            from_dir.path().join("history.jsonl"),
            serde_json::to_string(&entry(
                1_000,
                "task.created",
                "task",
                "k_legacy",
                "Legacy".into(),
                "Created task",
            ))
            .unwrap()
                + "\n",
        )
        .unwrap();

        copy_own_history(&from, &to).unwrap();

        assert!(to_dir.path().join("history.jsonl").exists());
        let entries = read_all_history(&to).unwrap();
        assert_eq!(entries[0].entity_id, "k_legacy");
    }

    #[test]
    fn copy_own_history_skips_peer_sidecars() {
        let from_dir = tempdir().unwrap();
        let to_dir = tempdir().unwrap();
        let from = from_dir.path().join("tasks_dev.db");
        let to = to_dir.path().join("tasks_dev.db");
        append_history(
            &from,
            &[entry(
                1_000,
                "task.created",
                "task",
                "k_dev",
                "Dev".into(),
                "Created task",
            )],
        )
        .unwrap();
        fs::write(
            from_dir.path().join("history_peer.jsonl"),
            serde_json::to_string(&entry(
                2_000,
                "task.created",
                "task",
                "k_peer",
                "Peer".into(),
                "Created task",
            ))
            .unwrap()
                + "\n",
        )
        .unwrap();

        copy_own_history(&from, &to).unwrap();

        assert!(to_dir.path().join("history_dev.jsonl").exists());
        assert!(
            !to_dir.path().join("history_peer.jsonl").exists(),
            "peer history is not seeded — same as peer task replicas"
        );
    }

    #[test]
    fn copy_own_history_is_noop_within_same_folder() {
        let dir = tempdir().unwrap();
        let from = dir.path().join("tasks_dev.db");
        let to = dir.path().join("tasks_dev.db");
        append_history(
            &from,
            &[entry(
                1_000,
                "task.created",
                "task",
                "k_1",
                "One".into(),
                "Created task",
            )],
        )
        .unwrap();
        copy_own_history(&from, &to).unwrap();
        // Still a single sidecar; no duplicate/rename side effects.
        assert!(dir.path().join("history_dev.jsonl").exists());
    }

    #[test]
    fn append_history_is_atomic_and_leaves_no_tmp() {
        let dir = tempdir().unwrap();
        let data = dir.path().join("tasks_dev.db");
        append_history(
            &data,
            &[entry(
                1_000,
                "task.created",
                "task",
                "k_1",
                "One".into(),
                "Created task",
            )],
        )
        .unwrap();
        // Second append must replace safely (Windows rename-over-existing).
        append_history(
            &data,
            &[entry(
                2_000,
                "task.created",
                "task",
                "k_2",
                "Two".into(),
                "Created task",
            )],
        )
        .unwrap();
        let entries = read_all_history(&data).unwrap();
        assert_eq!(entries.len(), 2);
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert!(names.iter().any(|n| n == "history_dev.jsonl"));
        assert!(!names.iter().any(|n| n.ends_with(".tmp") || n.ends_with(".bak")));
    }
}
