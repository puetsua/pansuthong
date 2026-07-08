//! End-to-end multi-device sync test through the real store code.
//!
//! Two `AppState` instances (two device replicas) share one folder — exactly the
//! Google-Drive-folder setup two PCs use — and we drive edits both ways, asserting
//! the documents converge, produce no conflict files, and then go quiet (no sync
//! loop from the byte-non-deterministic `.db` snapshots).

use pansutong_lib::model::Task;
use pansutong_lib::store::AppState;
use pansutong_lib::sync::scan_conflict_files;

fn task(id: &str) -> Task {
    Task {
        id: id.into(),
        title: id.into(),
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

fn ids(state: &AppState) -> Vec<String> {
    let mut v = state.read(|d| d.tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>());
    v.sort();
    v
}

#[test]
fn two_devices_converge_via_shared_folder_without_loops_or_conflicts() {
    let dir = tempfile::tempdir().unwrap();
    let path_a = dir.path().join("tasks_deviceA.db");
    let path_b = dir.path().join("tasks_deviceB.db");

    // Device A creates a task.
    let a = AppState::open(path_a.clone()).unwrap();
    a.write(|d| {
        d.tasks.push(task("from_a"));
        Ok(())
    })
    .unwrap();

    // Device B comes online (its cloud folder already holds A's replica) and must
    // see A's task on first open.
    let b = AppState::open(path_b.clone()).unwrap();
    assert_eq!(ids(&b), ["from_a"], "B adopts A's replica on open");

    // Device B adds its own task.
    b.write(|d| {
        d.tasks.push(task("from_b"));
        Ok(())
    })
    .unwrap();

    // A's poll detects B's replica and merges it in.
    assert!(a.reload_replicas_if_changed().unwrap(), "A sees B's new replica");
    assert_eq!(ids(&a), ["from_a", "from_b"]);

    // Let both devices' polls run until the system goes quiet. This MUST terminate
    // quickly — the whole point of content-hash change detection is that
    // re-materialized `.db` files (byte-different, same content) don't loop.
    let mut rounds = 0;
    loop {
        let ra = a.reload_replicas_if_changed().unwrap();
        let rb = b.reload_replicas_if_changed().unwrap();
        if !ra && !rb {
            break;
        }
        rounds += 1;
        assert!(rounds < 10, "sync did not settle — a content-hash loop is likely");
    }

    // Both devices converged on the union.
    assert_eq!(ids(&a), ["from_a", "from_b"], "A converged");
    assert_eq!(ids(&b), ["from_a", "from_b"], "B converged");

    // And no conflict files were produced by ordinary concurrent edits.
    assert!(scan_conflict_files(&path_a).is_empty(), "no conflict files for A");
    assert!(scan_conflict_files(&path_b).is_empty(), "no conflict files for B");
}

#[test]
fn a_deletion_on_one_device_tombstones_across_the_folder() {
    let dir = tempfile::tempdir().unwrap();
    let path_a = dir.path().join("tasks_deviceA.db");
    let path_b = dir.path().join("tasks_deviceB.db");

    let a = AppState::open(path_a).unwrap();
    a.write(|d| {
        d.tasks.push(task("k1"));
        d.tasks.push(task("k2"));
        Ok(())
    })
    .unwrap();

    let b = AppState::open(path_b).unwrap();
    assert_eq!(ids(&b), ["k1", "k2"]);

    // B deletes k1 (recording a tombstone), A must not resurrect it on merge.
    b.write(|d| {
        let ts = pansutong_lib::model::now_ms();
        d.tasks.retain(|t| t.id != "k1");
        d.deleted_tasks.push(pansutong_lib::model::Tombstone {
            id: "k1".into(),
            deleted_at: ts,
            deleted_by: None,
        });
        Ok(())
    })
    .unwrap();

    assert!(a.reload_replicas_if_changed().unwrap());
    assert_eq!(ids(&a), ["k2"], "A honors B's tombstone, does not resurrect k1");
}
