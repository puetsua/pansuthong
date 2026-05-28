use crate::model::{Document, Task};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
                    already.insert(t.id.clone());
                }
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
        if let Some(d) = decided.get(t.id.as_str()) {
            match d {
                Decision::KeepTheirs { .. } | Decision::KeepBoth { .. } => {
                    out.push(t.clone());
                }
                _ => {}
            }
        }
    }

    out
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
        && a.done == b.done
        && a.due_date == b.due_date
        && a.scheduled_date == b.scheduled_date
        && a.priority == b.priority
        && a.notes == b.notes
        && a.tag_ids == b.tag_ids
}
