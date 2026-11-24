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
    /// Device that recorded this line (this install's id). Absent on legacy lines.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    /// Readable device label (prefer OS hostname). Absent on legacy lines.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_name: Option<String>,
    /// Stable key for merge-append dedup: `event|entity|entity_id|source_updated_at`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dedup_key: Option<String>,
}

/// Bare pre-per-device sidecar; migrated once into `history_<device>.jsonl` then deleted.
const LEGACY_HISTORY_FILE: &str = "history.jsonl";

pub fn history_path(data_path: &Path) -> PathBuf {
    // Always per-device: never bare `history.jsonl`. Non-`tasks_*` paths (e.g. legacy
    // `tasks.json`) use the same `"device"` fallback as `AppState::open`.
    let device = crate::config::device_id_from_data_path(data_path)
        .map(|id| crate::config::sanitize_device_id(&id))
        .unwrap_or_else(|| "device".to_string());
    data_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("history_{device}.jsonl"))
}

/// True for a top-level per-device sidecar (`history_<device>.jsonl`). Rejects
/// path separators so SAF names cannot escape the folder, and does not match
/// the legacy bare `history.jsonl`.
pub fn is_history_sidecar_filename(name: &str) -> bool {
    !name.contains('/')
        && !name.contains('\\')
        && name.starts_with("history_")
        && name.ends_with(".jsonl")
}

fn legacy_history_path(data_path: &Path) -> PathBuf {
    data_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(LEGACY_HISTORY_FILE)
}

/// If bare `history.jsonl` exists beside the data file, append its lines into this
/// device's `history_<device>.jsonl` (respecting `dedup_key`), then delete the bare file.
pub fn migrate_legacy_history_jsonl(data_path: &Path) -> Result<()> {
    let legacy = legacy_history_path(data_path);
    if !legacy.exists() {
        return Ok(());
    }
    // Guard: if somehow own path were the bare file, do not delete while reading.
    let own = history_path(data_path);
    if legacy == own {
        return Ok(());
    }

    let mut entries = Vec::new();
    let file = fs::File::open(&legacy)?;
    for line in BufReader::new(file).lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<HistoryEntry>(&line) {
            Ok(entry) => entries.push(entry),
            Err(e) => eprintln!("warning: skipping unparseable legacy history line: {e}"),
        }
    }
    let unseen = filter_unseen_entries(data_path, entries)?;
    append_history(data_path, &unseen)?;
    fs::remove_file(&legacy)?;
    Ok(())
}

fn history_replica_paths(data_path: &Path) -> Vec<PathBuf> {
    let parent = data_path.parent().unwrap_or_else(|| Path::new("."));
    let mut paths = Vec::new();
    if let Ok(entries) = fs::read_dir(parent) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if is_history_sidecar_filename(&name) {
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

/// Stamp device identity onto entries (local writes and peer-merge appends).
pub fn stamp_device(entries: &mut [HistoryEntry], device_id: &str, device_name: &str) {
    for entry in entries {
        entry.device_id = Some(device_id.to_string());
        entry.device_name = Some(device_name.to_string());
    }
}

fn make_dedup_key(event: &str, entity: &str, entity_id: &str, source_updated_at: i64) -> String {
    format!("{event}|{entity}|{entity_id}|{source_updated_at}")
}

/// Keys already present in this device's own history sidecar (not peer replicas).
fn own_dedup_keys(data_path: &Path) -> Result<std::collections::HashSet<String>> {
    let mut keys = std::collections::HashSet::new();
    let path = history_path(data_path);
    if !path.exists() {
        return Ok(keys);
    }
    let file = fs::File::open(path)?;
    for line in BufReader::new(file).lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<HistoryEntry>(&line) {
            if let Some(key) = entry.dedup_key {
                keys.insert(key);
            }
        }
    }
    Ok(keys)
}

/// Drop entries whose `dedup_key` already exists in this device's history sidecar.
/// Entries without a `dedup_key` always pass through.
pub fn filter_unseen_entries(
    data_path: &Path,
    entries: Vec<HistoryEntry>,
) -> Result<Vec<HistoryEntry>> {
    if entries.is_empty() {
        return Ok(entries);
    }
    let existing = own_dedup_keys(data_path)?;
    if existing.is_empty() {
        return Ok(entries);
    }
    Ok(entries
        .into_iter()
        .filter(|entry| match &entry.dedup_key {
            Some(key) => !existing.contains(key),
            None => true,
        })
        .collect())
}

/// Copy this device's history sidecar when seeding an empty data folder.
///
/// Used by `AppState::repoint` so relocating the sync folder keeps History
/// continuous. Migrates any bare `history.jsonl` on the source into the
/// per-device sidecar first, then copies only `history_<device>.jsonl`.
/// Peer history replicas are left behind — same as peer task replicas, which
/// `repoint` also does not seed. No-op when `from` and `to` share a parent.
pub fn copy_own_history(from_data_path: &Path, to_data_path: &Path) -> Result<()> {
    let from_parent = from_data_path.parent().unwrap_or_else(|| Path::new("."));
    let to_parent = to_data_path.parent().unwrap_or_else(|| Path::new("."));
    if from_parent == to_parent {
        return Ok(());
    }
    fs::create_dir_all(to_parent)?;

    // Fold legacy bare sidecar into the device file before copying.
    migrate_legacy_history_jsonl(from_data_path)?;

    let from_own = history_path(from_data_path);
    let to_own = history_path(to_data_path);
    if to_own.exists() {
        // A leftover sidecar from an earlier stint in that folder: union, never
        // overwrite, so lines only the target has survive.
        return merge_own_history(from_data_path, to_data_path);
    }
    if from_own.exists() {
        fs::copy(&from_own, &to_own)?;
    }
    Ok(())
}

/// Union this device's history from `from` into the sidecar at `to` when merging
/// into a folder that already has data. The target may hold an older copy of the
/// same sidecar (from an earlier stint in that folder), so a source line is
/// appended only when the target has neither that exact line nor an entry with its
/// `dedup_key`. A bare legacy `history.jsonl` beside `from` is read too, but the
/// old folder is never modified (no migration there). `read_history` sorts by
/// timestamp, so append order does not matter. No-op when both share a parent.
pub fn merge_own_history(from_data_path: &Path, to_data_path: &Path) -> Result<()> {
    let from_parent = from_data_path.parent().unwrap_or_else(|| Path::new("."));
    let to_parent = to_data_path.parent().unwrap_or_else(|| Path::new("."));
    if from_parent == to_parent {
        return Ok(());
    }
    let mut source = String::new();
    for path in [history_path(from_data_path), legacy_history_path(from_data_path)] {
        if path.exists() {
            source.push_str(&fs::read_to_string(&path)?);
            source.push('\n');
        }
    }
    if source.trim().is_empty() {
        return Ok(());
    }
    let to_own = history_path(to_data_path);
    let mut bytes = if to_own.exists() {
        fs::read(&to_own)?
    } else {
        Vec::new()
    };
    let mut seen_lines: std::collections::HashSet<String> = String::from_utf8_lossy(&bytes)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    let mut seen_keys = own_dedup_keys(to_data_path)?;
    let mut missing = Vec::new();
    for line in source.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if !seen_lines.insert(line.to_string()) {
            continue;
        }
        let key = serde_json::from_str::<HistoryEntry>(line)
            .ok()
            .and_then(|e| e.dedup_key);
        if let Some(key) = key {
            if !seen_keys.insert(key) {
                continue;
            }
        }
        missing.push(line);
    }
    if missing.is_empty() {
        return Ok(());
    }
    fs::create_dir_all(to_parent)?;
    if !bytes.is_empty() && !bytes.ends_with(b"\n") {
        bytes.push(b'\n');
    }
    for line in missing {
        bytes.extend_from_slice(line.as_bytes());
        bytes.push(b'\n');
    }
    crate::store::atomic_write(&to_own, &bytes)
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
            stamp: task_stamp,
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
            stamp: tag_stamp,
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
            stamp: template_stamp,
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
    T: Serialize + PartialEq,
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
                (history.stamp)(new),
            )),
            (Some(old), None) => entries.push(entry(
                timestamp,
                history.deleted.0,
                history.entity,
                entity_id,
                (history.title)(old),
                history.deleted.1,
                (history.stamp)(old),
            )),
            // `!=` first: serializing every unchanged entity to a `Value` on every
            // write was the costliest part of a write on a large document (#249 N5).
            (Some(old), Some(new)) if old != new && to_value(old) != to_value(new) => {
                let (event, summary) = (history.update_kind)(old, new);
                entries.push(entry(
                    timestamp,
                    event,
                    history.entity,
                    entity_id,
                    (history.title)(new),
                    summary,
                    (history.stamp)(new),
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
    source_updated_at: i64,
) -> HistoryEntry {
    HistoryEntry {
        timestamp,
        event: event.to_string(),
        entity: entity.to_string(),
        entity_id: entity_id.to_string(),
        title,
        summary: summary.to_string(),
        device_id: None,
        device_name: None,
        dedup_key: Some(make_dedup_key(
            event,
            entity,
            entity_id,
            source_updated_at,
        )),
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
fn task_stamp(t: &Task) -> i64 {
    t.updated_at.max(t.created_at)
}
fn tag_id(t: &Tag) -> &str {
    &t.id
}
fn tag_title(t: &Tag) -> String {
    format!("#{}", t.name)
}
fn tag_stamp(t: &Tag) -> i64 {
    t.updated_at
}
fn template_id(t: &TemplateTask) -> &str {
    &t.id
}
fn template_title(t: &TemplateTask) -> String {
    t.title.clone()
}
fn template_stamp(t: &TemplateTask) -> i64 {
    t.updated_at.max(t.created_at)
}

type UpdateKind<T> = fn(&T, &T) -> (&'static str, &'static str);

struct EntityHistory<T> {
    entity: &'static str,
    id: fn(&T) -> &str,
    title: fn(&T) -> String,
    stamp: fn(&T) -> i64,
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
