use pansutong_lib::conflict::{apply_decisions, diff_tasks, Decision, TaskDiff};
use pansutong_lib::model::{Document, Task};

fn mk(id: &str, title: &str, done: bool) -> Task {
    Task {
        id: id.into(),
        title: title.into(),
        done,
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

fn doc(tasks: Vec<Task>) -> Document {
    let mut d = Document::default();
    d.tasks = tasks;
    d
}

#[test]
fn diff_finds_differs_only_mine_only_theirs() {
    let mine   = doc(vec![mk("a", "A1", false), mk("b", "B",  false)]);
    let theirs = doc(vec![mk("a", "A2", false), mk("c", "C",  false)]);
    let d = diff_tasks(&mine, &theirs);
    assert_eq!(d.len(), 3);
    let mut differs_seen = false;
    let mut mine_seen    = false;
    let mut theirs_seen  = false;
    for item in &d {
        match item {
            TaskDiff::Differs   { id, .. } if id == "a" => differs_seen = true,
            TaskDiff::OnlyMine  { id, .. } if id == "b" => mine_seen = true,
            TaskDiff::OnlyTheirs{ id, .. } if id == "c" => theirs_seen = true,
            _ => panic!("unexpected diff item {item:?}"),
        }
    }
    assert!(differs_seen && mine_seen && theirs_seen);
}

#[test]
fn diff_skips_identical_tasks() {
    let mine   = doc(vec![mk("a", "Same", false)]);
    let theirs = doc(vec![mk("a", "Same", false)]);
    let d = diff_tasks(&mine, &theirs);
    assert!(d.is_empty());
}

#[test]
fn apply_keep_mine_preserves_my_version() {
    let mine   = doc(vec![mk("a", "Mine",   false)]);
    let theirs = doc(vec![mk("a", "Theirs", false)]);
    let merged = apply_decisions(&mine, &theirs, &[
        Decision::KeepMine { id: "a".into() }
    ]);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].title, "Mine");
}

#[test]
fn apply_keep_theirs_overwrites_mine() {
    let mine   = doc(vec![mk("a", "Mine",   false)]);
    let theirs = doc(vec![mk("a", "Theirs", false)]);
    let merged = apply_decisions(&mine, &theirs, &[
        Decision::KeepTheirs { id: "a".into() }
    ]);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].title, "Theirs");
}

#[test]
fn apply_keep_both_clones_theirs_with_new_id() {
    let mine   = doc(vec![mk("a", "Mine",   false)]);
    let theirs = doc(vec![mk("a", "Theirs", false)]);
    let merged = apply_decisions(&mine, &theirs, &[
        Decision::KeepBoth { id: "a".into() }
    ]);
    assert_eq!(merged.len(), 2);
    assert!(merged.iter().any(|t| t.title == "Mine"   && t.id == "a"));
    assert!(merged.iter().any(|t| t.title == "Theirs" && t.id != "a"));
}

#[test]
fn apply_drop_removes_task() {
    let mine   = doc(vec![mk("a", "Mine", false), mk("b", "Keep", false)]);
    let theirs = doc(vec![]);
    let merged = apply_decisions(&mine, &theirs, &[
        Decision::Drop { id: "a".into() }
    ]);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].id, "b");
}

#[test]
fn apply_only_theirs_keep_theirs_imports() {
    let mine   = doc(vec![mk("a", "A", false)]);
    let theirs = doc(vec![mk("c", "C", false)]);
    let merged = apply_decisions(&mine, &theirs, &[
        Decision::KeepTheirs { id: "c".into() }
    ]);
    assert_eq!(merged.len(), 2);
    assert!(merged.iter().any(|t| t.id == "a"));
    assert!(merged.iter().any(|t| t.id == "c"));
}

#[test]
fn unmentioned_tasks_default_to_keep_both_sides() {
    // Differs default to "keep mine"; OnlyMine kept; OnlyTheirs ALSO kept.
    let mine   = doc(vec![mk("a", "A",  false), mk("b", "B", false)]);
    let theirs = doc(vec![mk("a", "A2", false), mk("c", "C", false)]);
    let merged = apply_decisions(&mine, &theirs, &[]);
    assert_eq!(merged.len(), 3);
    assert!(merged.iter().any(|t| t.id == "a" && t.title == "A")); // mine wins on Differs
    assert!(merged.iter().any(|t| t.id == "b" && t.title == "B"));
    assert!(merged.iter().any(|t| t.id == "c" && t.title == "C")); // theirs-only kept
}
