use pansutong_lib::model::{new_task_id, Task};
use pansutong_lib::store::AppState;
use std::fs;
use tempfile::tempdir;

fn make_task(title: &str) -> Task {
    Task {
        id: new_task_id(),
        title: title.into(),
        due_date: None,
        due_time: None,
        scheduled_date: None,
        scheduled_time: None,
        notes: String::new(),
        tag_ids: Vec::new(),
        created_at: 0,
        completed_at: None,
        updated_at: 0,
    }
}

#[test]
fn open_creates_default_document_when_missing() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("tasks.json");
    let state = AppState::open(path.clone()).unwrap();
    assert!(path.exists());
    state.read(|d| {
        assert_eq!(d.version, 5);
        assert!(d.tasks.is_empty());
    });
}

#[test]
fn write_persists_and_round_trips() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("tasks.json");
    {
        let state = AppState::open(path.clone()).unwrap();
        state.write(|d| { d.tasks.push(make_task("hello")); Ok(()) }).unwrap();
    }
    let state = AppState::open(path.clone()).unwrap();
    state.read(|d| {
        assert_eq!(d.tasks.len(), 1);
        assert_eq!(d.tasks[0].title, "hello");
    });
}

#[test]
fn atomic_write_leaves_no_tmp_file() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("tasks.json");
    let state = AppState::open(path.clone()).unwrap();
    state.write(|d| { d.tasks.push(make_task("a")); Ok(()) }).unwrap();
    let entries: Vec<_> = fs::read_dir(dir.path()).unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    assert!(entries.iter().any(|n| n == "tasks.json"));
    assert!(!entries.iter().any(|n| n.ends_with(".tmp")));
}

#[test]
fn hash_updates_after_write() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("tasks.json");
    let state = AppState::open(path.clone()).unwrap();
    let before = state.last_written_hash();
    state.write(|d| { d.tasks.push(make_task("x")); Ok(()) }).unwrap();
    let after = state.last_written_hash();
    assert_ne!(before, after);
}
