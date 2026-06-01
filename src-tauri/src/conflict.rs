use crate::model::{Document, Tag, Task};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TaskDiff {
    Differs { id: String, mine: Task, theirs: Task },
    OnlyMine   { id: String, mine: Task },
    OnlyTheirs { id: String, theirs: Task },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Decision {
    KeepMine   { id: String },
    KeepTheirs { id: String },
    KeepBoth   { id: String },
    Drop       { id: String },
}

pub fn diff_tasks(mine: &Document, theirs: &Document) -> Vec<TaskDiff> {
    let theirs_by_id: HashMap<&str, &Task> =
        theirs.tasks.iter().map(|t| (t.id.as_str(), t)).collect();
    let mine_by_id: HashMap<&str, &Task> =
        mine.tasks.iter().map(|t| (t.id.as_str(), t)).collect();

    let mut out = Vec::new();

    for t in &mine.tasks {
        match theirs_by_id.get(t.id.as_str()) {
            Some(theirs_t) if task_equal(t, theirs_t) => continue,
            Some(theirs_t) => out.push(TaskDiff::Differs {
                id: t.id.clone(), mine: t.clone(), theirs: (*theirs_t).clone(),
            }),
            None => out.push(TaskDiff::OnlyMine { id: t.id.clone(), mine: t.clone() }),
        }
    }
    for t in &theirs.tasks {
        if !mine_by_id.contains_key(t.id.as_str()) {
            out.push(TaskDiff::OnlyTheirs { id: t.id.clone(), theirs: t.clone() });
        }
    }
    out
}

pub fn apply_decisions(
    mine: &Document,
    theirs: &Document,
    decisions: &[Decision],
) -> Vec<Task> {
    let theirs_by_id: HashMap<&str, &Task> =
        theirs.tasks.iter().map(|t| (t.id.as_str(), t)).collect();
    let mut decided: HashMap<&str, &Decision> = HashMap::new();
    for d in decisions {
        decided.insert(decision_id(d), d);
    }

    let mut out: Vec<Task> = Vec::new();
    let mut already: std::collections::HashSet<String> = std::collections::HashSet::new();

    for t in &mine.tasks {
        let id = t.id.as_str();
        let action = decided.get(id);
        match action {
            None | Some(Decision::KeepMine { .. }) => {
                out.push(t.clone());
                already.insert(t.id.clone());
            }
            Some(Decision::KeepTheirs { .. }) => {
                if let Some(theirs_t) = theirs_by_id.get(id) {
                    out.push((*theirs_t).clone());
                } else {
                    // KeepTheirs on a task with no theirs version → fall back to keeping mine.
                    out.push(t.clone());
                }
                already.insert(t.id.clone());
            }
            Some(Decision::KeepBoth { .. }) => {
                out.push(t.clone());
                already.insert(t.id.clone());
                if let Some(theirs_t) = theirs_by_id.get(id) {
                    let mut copy = (*theirs_t).clone();
                    copy.id = crate::model::new_task_id();
                    out.push(copy);
                }
            }
            Some(Decision::Drop { .. }) => { /* skip */ }
        }
    }

    for t in &theirs.tasks {
        if already.contains(&t.id) { continue; }
        match decided.get(t.id.as_str()) {
            None => { out.push(t.clone()); }   // default: keep theirs-only tasks
            Some(Decision::KeepTheirs { .. }) |
            Some(Decision::KeepBoth   { .. }) => { out.push(t.clone()); }
            Some(Decision::Drop       { .. }) => { /* skip */ }
            Some(Decision::KeepMine   { .. }) => { /* skip — "keep mine" on theirs-only = drop */ }
        }
    }

    out
}

/// Tags from `theirs` that the resolved task list references but `mine` lacks.
/// Conflict resolution keeps tasks that may carry tags living only in the other
/// device's document; without merging those tags the references dangle and the
/// task silently falls into Inbox at priority 0 (#30).
pub fn tags_to_merge(tasks: &[Task], mine: &Document, theirs: &Document) -> Vec<Tag> {
    let mine_ids: HashSet<&str> = mine.tags.iter().map(|t| t.id.as_str()).collect();
    let theirs_by_id: HashMap<&str, &Tag> =
        theirs.tags.iter().map(|t| (t.id.as_str(), t)).collect();

    let mut added: Vec<Tag> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for task in tasks {
        for id in &task.tag_ids {
            let id = id.as_str();
            if mine_ids.contains(id) || seen.contains(id) {
                continue;
            }
            if let Some(tag) = theirs_by_id.get(id) {
                added.push((*tag).clone());
                seen.insert(id);
            }
        }
    }
    added
}

fn decision_id(d: &Decision) -> &str {
    match d {
        Decision::KeepMine   { id } |
        Decision::KeepTheirs { id } |
        Decision::KeepBoth   { id } |
        Decision::Drop       { id } => id.as_str(),
    }
}

fn task_equal(a: &Task, b: &Task) -> bool {
    a.title == b.title
        && a.done() == b.done()
        && a.archived() == b.archived()
        && a.is_template == b.is_template
        && a.due_offset_days == b.due_offset_days
        && a.scheduled_offset_days == b.scheduled_offset_days
        && a.due_date == b.due_date
        && a.scheduled_date == b.scheduled_date
        && a.notes == b.notes
        && a.tag_ids == b.tag_ids
}

#[cfg(test)]
mod merge_tests {
    use super::*;

    fn tag(id: &str) -> Tag {
        Tag { id: id.into(), name: id.into(), color: "#000".into(), priority: 5, pinned: false }
    }

    fn task_with_tags(id: &str, tag_ids: &[&str]) -> Task {
        Task {
            id: id.into(), title: id.into(),
            due_date: None, scheduled_date: None, notes: String::new(),
            tag_ids: tag_ids.iter().map(|s| s.to_string()).collect(),
            created_at: 0, completed_at: None, updated_at: 0,
            is_template: false, due_offset_days: None, scheduled_offset_days: None,
        }
    }

    #[test]
    fn merges_theirs_only_tag_referenced_by_a_kept_task() {
        let mine = Document::default();
        let mut theirs = Document::default();
        theirs.tags.push(tag("t_work"));
        let kept = task_with_tags("k_1", &["t_work"]);

        let added = tags_to_merge(&[kept], &mine, &theirs);
        assert_eq!(added.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["t_work"]);
    }

    #[test]
    fn does_not_duplicate_a_tag_mine_already_has() {
        let mut mine = Document::default();
        mine.tags.push(tag("t_work"));
        let mut theirs = Document::default();
        theirs.tags.push(tag("t_work"));
        let kept = task_with_tags("k_1", &["t_work"]);

        assert!(tags_to_merge(&[kept], &mine, &theirs).is_empty());
    }

    #[test]
    fn ignores_dangling_ids_absent_from_theirs() {
        let mine = Document::default();
        let theirs = Document::default();
        let kept = task_with_tags("k_1", &["t_ghost"]);

        assert!(tags_to_merge(&[kept], &mine, &theirs).is_empty());
    }

    #[test]
    fn de_duplicates_when_two_tasks_reference_the_same_tag() {
        let mine = Document::default();
        let mut theirs = Document::default();
        theirs.tags.push(tag("t_work"));
        let a = task_with_tags("k_1", &["t_work"]);
        let b = task_with_tags("k_2", &["t_work"]);

        let added = tags_to_merge(&[a, b], &mine, &theirs);
        assert_eq!(added.len(), 1);
    }
}
