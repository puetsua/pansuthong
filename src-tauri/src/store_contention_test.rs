//! Contention harness for N5 (PR #249 QA r3): concurrent MCP-style writers going
//! through `task_ops` while a simulated UI thread does what the window does on the
//! main thread — `get_document` (read + clone + serialize) and a small UI write.
//!
//! `ui_latency_under_concurrent_writers` is `#[ignore]`d and prints numbers:
//!
//! ```text
//! N5_TASKS=5000 N5_SECS=5 cargo test --release --lib store_contention -- --ignored --nocapture
//! ```
//!
//! `N5_WRITERS=4` runs a single writer count; `N5_NOTE_BYTES` sizes each seeded
//! task's notes (e.g. 3000 tasks × 5000 bytes ≈ a 16 MiB document).

use crate::commands::NewTaskInput;
use crate::model::{new_task_id, Document, Task};
use crate::store::AppState;
use crate::task_ops::{add_task_record, set_task_done_record};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

fn task(title: String) -> Task {
    task_with_notes(title, "harness note ".repeat(8))
}

fn task_with_notes(title: String, notes: String) -> Task {
    Task {
        id: new_task_id(),
        title,
        due_date: None,
        due_time: None,
        start_date: None,
        start_time: None,
        notes,
        attachments: vec![],
        tag_ids: vec![],
        estimated_seconds: None,
        created_at: 1,
        completed_at: None,
        updated_at: 1,
        time_entries: vec![],
    }
}

fn seeded_store(dir: &std::path::Path, tasks: usize) -> AppState {
    seeded_store_with_notes(dir, tasks, 104)
}

fn seeded_store_with_notes(dir: &std::path::Path, tasks: usize, note_bytes: usize) -> AppState {
    let state = AppState::open(dir.join("tasks_harness.db")).unwrap();
    state
        .write(|d| {
            *d = Document {
                tasks: (0..tasks)
                    .map(|i| task_with_notes(format!("seed {i}"), "n".repeat(note_bytes)))
                    .collect(),
                ..Document::default()
            };
            Ok(())
        })
        .unwrap();
    state
}

fn new_input(title: String) -> NewTaskInput {
    NewTaskInput {
        title,
        due_date: None,
        due_time: None,
        start_date: None,
        start_time: None,
        notes: String::new(),
        attachments: vec![],
        tag_ids: vec![],
        estimated_seconds: None,
    }
}

/// What `get_document` does on the UI thread: read, clone, serialize for IPC.
fn ui_read(state: &AppState) -> usize {
    let (tasks, tags) = state.read(|d| (d.tasks.clone(), d.tags.clone()));
    serde_json::to_vec(&(tasks, tags)).unwrap().len()
}

struct Stats {
    n: usize,
    p50: Duration,
    p99: Duration,
    max: Duration,
}

fn stats(mut v: Vec<Duration>) -> Stats {
    v.sort();
    let at = |q: f64| v[((v.len() as f64 - 1.0) * q) as usize];
    Stats {
        n: v.len(),
        p50: at(0.5),
        p99: at(0.99),
        max: *v.last().unwrap(),
    }
}

struct Run {
    writes: usize,
    read: Stats,
    write: Stats,
}

fn run(writers: usize, tasks: usize, note_bytes: usize, secs: u64) -> Run {
    let dir = tempfile::tempdir().unwrap();
    let state = Arc::new(seeded_store_with_notes(dir.path(), tasks, note_bytes));
    let probe_id = state.read(|d| d.tasks[0].id.clone());
    let stop = Arc::new(AtomicBool::new(false));
    let writes = Arc::new(AtomicUsize::new(0));
    // Writers also give up well after the run, so a fully starved UI thread still
    // finishes (and reports the starvation) instead of hanging the harness.
    let give_up = Instant::now() + Duration::from_secs(secs + 60);
    let handles: Vec<_> = (0..writers)
        .map(|w| {
            let (state, stop, writes) = (state.clone(), stop.clone(), writes.clone());
            std::thread::spawn(move || {
                let mut i = 0;
                while !stop.load(Ordering::Relaxed) && Instant::now() < give_up {
                    add_task_record(&state, new_input(format!("w{w} #{i}"))).unwrap();
                    writes.fetch_add(1, Ordering::Relaxed);
                    i += 1;
                }
            })
        })
        .collect();

    // Simulated UI thread: alternate a document read and a small write, with a
    // frame-sized pause between, for `secs`. Each op is timed from the moment the
    // UI asked for it.
    let mut reads = Vec::new();
    let mut ui_writes = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(secs);
    let mut done = false;
    while Instant::now() < deadline {
        let t = Instant::now();
        ui_read(&state);
        reads.push(t.elapsed());
        let t = Instant::now();
        set_task_done_record(&state, &probe_id, !done).unwrap();
        ui_writes.push(t.elapsed());
        done = !done;
        std::thread::sleep(Duration::from_millis(16));
    }
    stop.store(true, Ordering::Relaxed);
    for h in handles {
        h.join().unwrap();
    }
    Run {
        writes: writes.load(Ordering::Relaxed),
        read: stats(reads),
        write: stats(ui_writes),
    }
}

fn env_or(key: &str, default: usize) -> usize {
    std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

#[test]
#[ignore = "timing harness; run with --ignored --nocapture"]
fn ui_latency_under_concurrent_writers() {
    let tasks = env_or("N5_TASKS", 5000);
    let secs = env_or("N5_SECS", 5) as u64;
    let note_bytes = env_or("N5_NOTE_BYTES", 104);
    let counts = match std::env::var("N5_WRITERS").ok().and_then(|v| v.parse().ok()) {
        Some(n) => vec![n],
        None => vec![0, 1, 2, 4],
    };
    println!("tasks={tasks} note_bytes={note_bytes} secs={secs}");
    println!("writers | writes/s | ui_read p50/p99/max (ms) | ui_write p50/p99/max (ms) | ui ops");
    for writers in counts {
        let r = run(writers, tasks, note_bytes, secs);
        let ms = |d: Duration| d.as_secs_f64() * 1000.0;
        println!(
            "{writers:7} | {:8.1} | {:7.1} / {:7.1} / {:7.1} | {:7.1} / {:7.1} / {:7.1} | {}",
            r.writes as f64 / secs as f64,
            ms(r.read.p50),
            ms(r.read.p99),
            ms(r.read.max),
            ms(r.write.p50),
            ms(r.write.p99),
            ms(r.write.max),
            r.read.n.min(r.write.n),
        );
    }
}

/// A UI read must not queue behind a writer that holds the store (e.g. while it
/// persists a large document). The writer below parks inside `write` until the
/// read has finished; before the fix the read blocked on the store mutex and this
/// test timed out.
#[test]
fn read_does_not_wait_for_in_progress_write() {
    let dir = tempfile::tempdir().unwrap();
    let state = Arc::new(seeded_store(dir.path(), 3));
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel::<()>();
    let writer = {
        let state = state.clone();
        std::thread::spawn(move || {
            state
                .write(|d| {
                    d.tasks.push(task("in-flight".into()));
                    entered_tx.send(()).unwrap();
                    let _ = release_rx.recv_timeout(Duration::from_secs(10));
                    Ok(())
                })
                .unwrap();
        })
    };
    entered_rx.recv().unwrap();
    let (read_tx, read_rx) = mpsc::channel();
    {
        let state = state.clone();
        std::thread::spawn(move || {
            let _ = read_tx.send(state.read(|d| d.tasks.len()));
        });
    }
    let seen = read_rx.recv_timeout(Duration::from_secs(2));
    release_tx.send(()).unwrap();
    writer.join().unwrap();
    // The read sees the last committed document, not the uncommitted push.
    assert_eq!(seen, Ok(3), "read blocked behind an in-progress write");
    assert_eq!(state.read(|d| d.tasks.len()), 4);
}
