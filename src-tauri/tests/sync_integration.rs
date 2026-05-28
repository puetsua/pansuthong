use pansutong_lib::sync::scan_conflict_files;
use std::fs;
use std::path::PathBuf;
use tempfile::tempdir;

fn touch(path: &PathBuf, contents: &str) {
    fs::write(path, contents).unwrap();
}

#[test]
fn scanner_finds_syncthing_conflict_siblings() {
    let dir  = tempdir().unwrap();
    let data = dir.path().join("tasks.json");
    touch(&data, "{}");

    let c1 = dir.path().join("tasks.sync-conflict-20260528-123045-7AB2C9D.json");
    let c2 = dir.path().join("tasks.sync-conflict-20260528-090000-ZZZZZ.json");
    touch(&c1, "{}");
    touch(&c2, "{}");

    let found = scan_conflict_files(&data);
    assert_eq!(found.len(), 2);
    assert!(found.iter().any(|p| p == &c1.to_string_lossy()));
    assert!(found.iter().any(|p| p == &c2.to_string_lossy()));
}

#[test]
fn scanner_finds_dropbox_style_conflicts() {
    let dir  = tempdir().unwrap();
    let data = dir.path().join("tasks.json");
    touch(&data, "{}");

    let c = dir.path().join("tasks (conflicted copy 2026-05-28).json");
    touch(&c, "{}");

    let found = scan_conflict_files(&data);
    assert!(found.iter().any(|p| p == &c.to_string_lossy()),
            "expected to find dropbox-style sibling; got {:?}", found);
}

#[test]
fn scanner_ignores_the_data_file_itself() {
    let dir  = tempdir().unwrap();
    let data = dir.path().join("tasks.json");
    touch(&data, "{}");
    let found = scan_conflict_files(&data);
    assert!(found.is_empty());
}

#[test]
fn scanner_ignores_unrelated_files() {
    let dir  = tempdir().unwrap();
    let data = dir.path().join("tasks.json");
    touch(&data, "{}");
    touch(&dir.path().join("notes.txt"), "hi");
    touch(&dir.path().join("readme.md"),  "hi");
    let found = scan_conflict_files(&data);
    assert!(found.is_empty());
}

#[test]
fn scanner_handles_missing_parent_directory() {
    let bogus = PathBuf::from("/this/path/does/not/exist/tasks.json");
    let found = scan_conflict_files(&bogus);
    assert!(found.is_empty());
}
