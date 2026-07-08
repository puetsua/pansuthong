use crate::store::AppState;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const DEBOUNCE_MS: u64 = 250;
/// How often the fallback poll re-checks the file. Native FS events are unreliable
/// on cloud-sync folders (e.g. Google Drive) when a change is pulled down from
/// another device, so we also poll to guarantee those updates are picked up.
const POLL_INTERVAL_MS: u64 = 2000;
const STORE_CHANGED: &str = "store-changed";
const CONFLICTS_DETECTED: &str = "conflicts-detected";

pub struct SyncHandle {
    _watcher: RecommendedWatcher,
    _thread: thread::JoinHandle<()>,
    // Dropping this sender unblocks the poll thread's recv_timeout so it exits.
    _poll_stop: std::sync::mpsc::Sender<()>,
    _poll_thread: thread::JoinHandle<()>,
}

pub fn start(app: AppHandle, data_path: PathBuf) -> notify::Result<SyncHandle> {
    let parent = data_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let (tx, rx) = channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, Config::default())?;
    watcher.watch(&parent, RecursiveMode::NonRecursive)?;

    let app_for_thread = app.clone();
    let path_for_thread = data_path.clone();

    let handle = thread::spawn(move || {
        loop {
            // Block for the first event of a burst.
            if rx.recv().is_err() {
                break;
            }
            // Drain any follow-up events until DEBOUNCE_MS of quiet ends the burst.
            while rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)).is_ok() {}
            process_change(&app_for_thread, &path_for_thread);
        }
    });

    // Polling fallback: native FS events are missed when a cloud-sync client
    // (Google Drive) writes a change pulled from another device. Re-checking the
    // file every POLL_INTERVAL_MS guarantees those updates surface. process_change
    // is a cheap no-op when the on-disk hash matches our last write.
    let (poll_stop_tx, poll_stop_rx) = channel::<()>();
    let app_for_poll = app.clone();
    let path_for_poll = data_path.clone();
    let poll_thread = thread::spawn(move || {
        use std::sync::mpsc::RecvTimeoutError;
        loop {
            match poll_stop_rx.recv_timeout(Duration::from_millis(POLL_INTERVAL_MS)) {
                // Sender dropped (watcher stopped/restarted) → exit.
                Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
                // Interval elapsed → poll.
                Err(RecvTimeoutError::Timeout) => process_change(&app_for_poll, &path_for_poll),
            }
        }
    });

    Ok(SyncHandle {
        _watcher: watcher,
        _thread: handle,
        _poll_stop: poll_stop_tx,
        _poll_thread: poll_thread,
    })
}

fn process_change(app: &AppHandle, data_path: &Path) {
    if let Some(state) = app.try_state::<AppState>() {
        if reload_if_changed(&state, data_path) {
            let _ = app.emit(STORE_CHANGED, ());
        }
    }

    let conflicts = scan_conflict_files(data_path);
    if !conflicts.is_empty() {
        let _ = app.emit(CONFLICTS_DETECTED, &conflicts);
    }
}

/// Reload the in-memory document if any per-device replica in the data folder
/// changed. Returns `true` when a reload happened so the caller can notify the UI.
pub(crate) fn reload_if_changed(state: &AppState, data_path: &Path) -> bool {
    let _ = data_path;
    state.reload_replicas_if_changed().unwrap_or(false)
}

use std::sync::Mutex;

/// Managed wrapper so the watcher can be replaced when the data path changes.
pub struct WatcherHandle(pub Mutex<Option<SyncHandle>>);

/// Stop the current watcher (if any) and start a new one on `data_path`'s dir.
pub fn restart(handle: &WatcherHandle, app: &AppHandle, data_path: PathBuf) {
    let mut g = handle.0.lock().unwrap_or_else(|e| e.into_inner());
    *g = None; // drop the old watcher + let its thread exit
    match start(app.clone(), data_path) {
        Ok(h) => {
            *g = Some(h);
        }
        Err(e) => {
            eprintln!("warning: failed to restart watcher: {e}");
        }
    }
}

/// True if `name` is a conflict file this scanner produces and recognizes: it
/// mentions "conflict", begins with the data file's stem, ends with ".json", and
/// is not the data file itself. Case-insensitive so it matches on Windows. The
/// single source of truth for the naming pattern — also used by the conflict
/// commands to confine the paths they read/delete to real conflict files (#49).
pub(crate) fn is_conflict_file_name(name: &str, stem: &str, data_file_name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("conflict")
        && lower.starts_with(&stem.to_lowercase())
        && lower.ends_with(".json")
        && name != data_file_name
}

pub fn scan_conflict_files(data_path: &Path) -> Vec<String> {
    let parent = match data_path.parent() {
        Some(p) => p,
        None => return Vec::new(),
    };
    let stem = data_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("tasks");
    let data_file_name = data_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(parent) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if is_conflict_file_name(&name, stem, data_file_name) {
            out.push(entry.path().to_string_lossy().to_string());
        }
    }
    out.sort();
    out
}

#[cfg(test)]
mod poll_tests {
    use super::*;
    use crate::store::AppState;
    use tempfile::tempdir;

    #[test]
    fn reload_if_changed_detects_out_of_band_write() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_desktop.db");
        let state = AppState::open(path.clone()).unwrap();

        // Nothing changed since open → no reload.
        assert!(!reload_if_changed(&state, &path));

        // Simulate Google Drive syncing another device's replica down: a peer
        // `tasks_<peer>.db` appears in the folder (not written through our store,
        // so no FS event is guaranteed) carrying a tag we don't have. A `.json`
        // peer is accepted too (cross-version), and is simplest to author here.
        let mut peer = crate::model::Document::default();
        peer.tags.push(crate::model::Tag {
            id: "t_x".into(),
            name: "x".into(),
            color: "#fff".into(),
            priority: 0,
            pinned: false,
            updated_at: 1,
            dashboard_view: None,
        });
        std::fs::write(
            dir.path().join("tasks_peer.json"),
            serde_json::to_vec_pretty(&peer).unwrap(),
        )
        .unwrap();

        // The polling core detects the new peer replica and merges it in.
        assert!(reload_if_changed(&state, &path));
        assert_eq!(
            state.read(|d| d.tags.iter().map(|t| t.id.clone()).collect::<Vec<_>>()),
            ["t_x"]
        );

        // Idempotent: a second poll with no further change is a no-op.
        assert!(!reload_if_changed(&state, &path));
    }
}
