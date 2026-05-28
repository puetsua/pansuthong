use crate::store::AppState;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const DEBOUNCE_MS: u64 = 250;
const STORE_CHANGED:       &str = "store-changed";
const CONFLICTS_DETECTED:  &str = "conflicts-detected";

pub struct SyncHandle {
    _watcher: RecommendedWatcher,
    _thread:  thread::JoinHandle<()>,
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
            // Drain any follow-up events in a DEBOUNCE_MS quiet window.
            loop {
                match rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)) {
                    Ok(_)  => continue, // burst still happening; keep draining
                    Err(_) => break,    // quiet for DEBOUNCE_MS — burst is over
                }
            }
            process_change(&app_for_thread, &path_for_thread);
        }
    });

    Ok(SyncHandle { _watcher: watcher, _thread: handle })
}

fn process_change(app: &AppHandle, data_path: &Path) {
    if let Some(state) = app.try_state::<AppState>() {
        let bytes = match std::fs::read(data_path) {
            Ok(b) => b,
            Err(_) => return,
        };
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let on_disk_hash: [u8; 32] = hasher.finalize().into();

        let last_written = state.last_written_hash();
        if on_disk_hash != last_written {
            match state.reload_from_bytes(bytes) {
                Ok(()) => { let _ = app.emit(STORE_CHANGED, ()); }
                Err(_) => { /* TODO: surface a "data file unreadable" toast */ }
            }
        }
    }

    let conflicts = scan_conflict_files(data_path);
    if !conflicts.is_empty() {
        let _ = app.emit(CONFLICTS_DETECTED, &conflicts);
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
