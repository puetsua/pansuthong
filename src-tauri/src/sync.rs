use crate::store::AppState;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use sha2::{Digest, Sha256};
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
const STORE_CHANGED:       &str = "store-changed";
const CONFLICTS_DETECTED:  &str = "conflicts-detected";

pub struct SyncHandle {
    _watcher: RecommendedWatcher,
    _thread:  thread::JoinHandle<()>,
    // Dropping this sender unblocks the poll thread's recv_timeout so it exits.
    _poll_stop:   std::sync::mpsc::Sender<()>,
    _poll_thread: thread::JoinHandle<()>,
}

pub fn start(app: AppHandle, data_path: PathBuf) -> notify::Result<SyncHandle> {
    let parent = data_path.parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let (tx, rx) = channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, Config::default())?;
    watcher.watch(&parent, RecursiveMode::NonRecursive)?;

    let app_for_thread   = app.clone();
    let path_for_thread  = data_path.clone();

    let handle = thread::spawn(move || {
        loop {
            // Block for the first event of a burst.
            if rx.recv().is_err() { break; }
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
    let app_for_poll  = app.clone();
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
        _watcher:     watcher,
        _thread:      handle,
        _poll_stop:   poll_stop_tx,
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

/// Reload the in-memory document if the on-disk file differs from what we last
/// wrote. Returns `true` when a reload happened (so the caller can notify the UI).
/// Decoupled from Tauri so it can be unit-tested and reused by the FS-event thread,
/// the polling thread, and the manual `sync_now` command.
pub(crate) fn reload_if_changed(state: &AppState, data_path: &Path) -> bool {
    let bytes = match std::fs::read(data_path) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let on_disk_hash: [u8; 32] = hasher.finalize().into();

    if on_disk_hash == state.last_written_hash() {
        return false;
    }
    // Content differs from our last write — adopt it.
    state.reload_from_bytes(bytes).is_ok()
}

use std::sync::Mutex;

/// Managed wrapper so the watcher can be replaced when the data path changes.
pub struct WatcherHandle(pub Mutex<Option<SyncHandle>>);

/// Stop the current watcher (if any) and start a new one on `data_path`'s dir.
pub fn restart(handle: &WatcherHandle, app: &AppHandle, data_path: PathBuf) {
    let mut g = handle.0.lock().unwrap_or_else(|e| e.into_inner());
    *g = None; // drop the old watcher + let its thread exit
    match start(app.clone(), data_path) {
        Ok(h) => { *g = Some(h); }
        Err(e) => { eprintln!("warning: failed to restart watcher: {e}"); }
    }
}

pub fn scan_conflict_files(data_path: &Path) -> Vec<String> {
    let parent = match data_path.parent() {
        Some(p) => p,
        None => return Vec::new(),
    };
    let stem = data_path.file_stem().and_then(|s| s.to_str()).unwrap_or("tasks");
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(parent) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if lower.contains("conflict")
            && lower.starts_with(&stem.to_lowercase())
            && lower.ends_with(".json")
            && name != data_path.file_name().and_then(|n| n.to_str()).unwrap_or("")
        {
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
        let path = dir.path().join("tasks.json");
        let state = AppState::open(path.clone()).unwrap();

        // Nothing changed since open → no reload.
        assert!(!reload_if_changed(&state, &path));

        // Simulate Google Drive syncing a cloud-pulled change down: overwrite the
        // file out-of-band (not through AppState::write, so no FS event is
        // guaranteed) with a different document.
        let mut doc = state.read(|d| d.clone());
        doc.settings.theme = "dark".into();
        std::fs::write(&path, serde_json::to_vec_pretty(&doc).unwrap()).unwrap();

        // The polling core detects the difference and reloads the in-memory doc.
        assert!(reload_if_changed(&state, &path));
        assert_eq!(state.read(|d| d.settings.theme.clone()), "dark");

        // Idempotent: a second poll with no further change is a no-op.
        assert!(!reload_if_changed(&state, &path));
    }
}
