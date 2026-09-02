//! Android folder-sync mirror layer.
//!
//! The app-private `tasks_<device>.db` remains the crash-safe master (`store.rs`).
//! This module mirrors it (and conflict copies / attachment blobs / history
//! sidecars) to/from a user-picked SAF folder. All SAF I/O is hidden behind
//! `SafBackend` so the mirror logic is testable on desktop; the real Android
//! backend lives in the `android` submodule.
//!
//! Wire format matches desktop: per-device `.db` replicas, legacy JSON peers still
//! readable, attachments under `attachments_<device>/` (plus legacy flat files),
//! and per-device `history_<device>.jsonl` sidecars.

use crate::commands::is_attachment_filename;
use crate::error::Result;
use crate::history::{self, is_history_sidecar_filename};
use crate::model::{merge_documents, Document};
use crate::store::{content_hash, AppState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const BASE_FILENAME: &str = "tasks.json";
const BASE_STEM: &str = "tasks";
const CONFLICT_NEEDLE: &str = "conflict";

/// Abstraction over the picked SAF folder. Implemented for real on Android and
/// with an in-memory fake in tests.
///
/// File names may be top-level (`tasks_dev.db`, `attachment_…`) or one-level
/// nested (`attachments_dev/attachment_…`). Nested paths use `/` as the separator.
pub trait SafBackend {
    /// Legacy remote `tasks.json` bytes, or `None` if it doesn't exist yet.
    fn read_tasks(&self) -> Result<Option<Vec<u8>>>;
    /// Relative paths of files in the folder (top-level and one-level attachment subdirs).
    fn list_file_names(&self) -> Result<Vec<String>>;
    /// Read a file by relative path (may include one `/`).
    fn read_file(&self, name: &str) -> Result<Vec<u8>>;
    /// Create-or-overwrite a file by relative path (creates parent dir if needed).
    fn write_file(&self, name: &str, bytes: &[u8]) -> Result<()>;
    /// Delete a file by relative path (no-op if absent).
    fn delete_file(&self, name: &str) -> Result<()>;
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().into()
}

/// True if `name` is a conflict copy of the base data file.
pub fn is_conflict_filename(name: &str, base_stem: &str, base_filename: &str) -> bool {
    name != base_filename
        && name.starts_with(base_stem)
        && name.ends_with(".json")
        && name.contains(CONFLICT_NEEDLE)
}

fn is_replica_filename(name: &str) -> bool {
    name.starts_with("tasks_")
        && (name.ends_with(".db") || name.ends_with(".json"))
        && !name.contains(CONFLICT_NEEDLE)
}

fn replica_stem(name: &str) -> &str {
    name.rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(name)
}

/// Prefer `.db` when both `tasks_X.db` and `tasks_X.json` exist for the same stem.
fn pick_replica_names(names: &[String]) -> Vec<String> {
    let mut by_stem: HashMap<String, String> = HashMap::new();
    for name in names {
        if !is_replica_filename(name) {
            continue;
        }
        let stem = replica_stem(name).to_string();
        let prefer_db = name.ends_with(".db");
        match by_stem.get(&stem) {
            Some(existing) if existing.ends_with(".db") => {}
            Some(_) if prefer_db => {
                by_stem.insert(stem, name.clone());
            }
            None => {
                by_stem.insert(stem, name.clone());
            }
            _ => {}
        }
    }
    by_stem.into_values().collect()
}

fn writable_replica_name(data_path: &Path) -> String {
    let name = data_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("tasks.db");
    if is_replica_filename(name) {
        if name.ends_with(".json") {
            return format!("{}.db", replica_stem(name));
        }
        return name.to_string();
    }
    if name == BASE_FILENAME || name == "tasks.db" {
        return "tasks.db".into();
    }
    // Unknown local name — still publish a `.db` beside peers.
    "tasks.db".into()
}

fn decode_replica_bytes(name: &str, bytes: &[u8]) -> Result<Document> {
    if name.ends_with(".db") {
        crate::db::load_from_bytes(bytes)
    } else {
        crate::store::parse_checked(bytes)
    }
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn mime_for_name(name: &str) -> Option<&'static str> {
    if name.ends_with(".json") {
        Some("application/json")
    } else if name.ends_with(".jsonl") {
        Some("application/jsonl")
    } else if name.ends_with(".db") {
        Some("application/vnd.sqlite3")
    } else {
        Some("application/octet-stream")
    }
}

/// What a first link to a picked folder should do, decided **fail-safe**.
#[derive(Debug, PartialEq, Eq)]
pub enum LinkAction {
    /// The folder already holds a tasks replica — pull and merge into local.
    Pull,
    /// The folder is confirmed to have no `tasks.json` — seed it from the local
    /// document (the only case where writing is safe).
    Seed,
    /// The folder's state could not be determined — do nothing destructive.
    Abort,
}

/// True if the picked folder already contains a tasks replica. Uses directory
/// enumeration (`list_file_names`), which works across SAF providers including
/// Google Drive, and **propagates errors** so a caller never mistakes "couldn't
/// read the folder" for "the folder is empty" — the latter is what overwrote a
/// real remote on first link (the Drive data-loss bug).
pub fn remote_has_tasks(backend: &dyn SafBackend) -> Result<bool> {
    Ok(backend.list_file_names()?.iter().any(|n| {
        n == BASE_FILENAME || n == "tasks.db" || is_replica_filename(n)
    }))
}

/// Decide a first link's action without ever risking the remote: only `Seed`
/// when the folder is positively known to be empty of `tasks.json`; `Pull` when
/// it already has one; `Abort` when the folder can't be read (so the existing
/// remote is left untouched and the error is surfaced instead).
pub fn first_link_action(backend: &dyn SafBackend) -> LinkAction {
    match remote_has_tasks(backend) {
        Ok(true) => LinkAction::Pull,
        Ok(false) => LinkAction::Seed,
        Err(_) => LinkAction::Abort,
    }
}

/// Push the current document to the folder unless it equals `last_synced_hash`.
/// Returns `Some(new_hash)` if a write happened, `None` if suppressed.
pub fn push_out(
    state: &AppState,
    backend: &dyn SafBackend,
    data_path: &Path,
    last_synced_hash: Option<[u8; 32]>,
) -> Result<Option<[u8; 32]>> {
    let doc = state.read(|d| d.clone());
    let h = content_hash(&doc);
    if Some(h) == last_synced_hash {
        mirror_local_attachment_files(backend, data_path)?;
        mirror_local_history_file(backend, data_path)?;
        return Ok(None);
    }
    // Single-file DELETE-journal store: the on-disk master is the publishable replica.
    let bytes = std::fs::read(state.path())?;
    backend.write_file(&writable_replica_name(data_path), &bytes)?;
    mirror_local_attachment_files(backend, data_path)?;
    mirror_local_history_file(backend, data_path)?;
    Ok(Some(h))
}

/// Outcome of a pull-in pass.
pub struct PullOutcome {
    pub imported: bool,
    pub new_synced_hash: Option<[u8; 32]>,
    pub conflict_count: usize,
    /// A non-fatal problem (e.g. the remote main document didn't parse) surfaced
    /// to `last_error` without throwing away the conflict files / attachments this
    /// pass already mirrored. `None` = clean pull.
    pub warning: Option<String>,
}

/// Mirror the folder into app-private: merge a changed remote replica document
/// with local (last-write-wins, same as desktop) and copy any external conflict
/// files into the app-private dir for the existing conflict UI. Never clobbers
/// the shadow with unparseable bytes.
pub fn pull_in(
    state: &AppState,
    backend: &dyn SafBackend,
    data_path: &Path,
    last_synced_hash: Option<[u8; 32]>,
) -> Result<PullOutcome> {
    let dir = data_path.parent().unwrap_or_else(|| Path::new("."));

    // 1. Mirror conflict files first (independent of main-file validity).
    let conflict_count = mirror_conflict_files(backend, dir)?;
    let attachments_imported = mirror_remote_attachment_files(backend, dir)?;
    let history_imported = mirror_remote_history_files(backend, data_path, false)?;

    // 2. Merge a changed, VALID remote replica document into local (same LWW
    //    path as desktop peer reload). A torn/garbage or newer-version remote
    //    is reported as a non-fatal warning rather than a hard error, so the
    //    conflict files and attachments mirrored above this pass still surface
    //    (and we retry adoption next pull, hash unchanged).
    //    last_synced_hash tracks the *remote* merge content hash so an unpushed
    //    local-only merge does not re-trigger pull every poll.
    let mut new_hash = last_synced_hash;
    let mut imported = false;
    let mut warning = None;
    match read_merged_remote(backend) {
        Ok((maybe_remote, skipped)) => {
            if !skipped.is_empty() {
                warning = Some(format!(
                    "saf: skipped {} unreadable replica(s): {}",
                    skipped.len(),
                    skipped.join(", ")
                ));
            }
            if let Some(remote) = maybe_remote {
                let h = content_hash(&remote);
                if Some(h) != last_synced_hash {
                    match state.adopt_synced(remote) {
                        Ok(_) => {
                            new_hash = Some(h);
                            imported = true;
                        }
                        Err(_) => {
                            warning = Some(
                                "saf: remote replica is not valid; kept local data".into(),
                            );
                        }
                    }
                }
            }
        }
        Err(e) => {
            warning = Some(format!("saf: could not read remote: {e}"));
        }
    }

    // Attachment tombstones adopted from the remote may have dropped live refs.
    // GC the local blobs now, or the next push's attachment mirror re-uploads a
    // file another device already deleted, resurrecting it in the synced folder.
    // Skipped on a degraded pull: with the remote only partially read, "locally
    // unreferenced" is not yet trustworthy.
    if warning.is_none() {
        crate::commands::gc_unreferenced_attachment_blobs(state);
    }

    Ok(PullOutcome {
        imported: imported || attachments_imported || history_imported,
        new_synced_hash: new_hash,
        conflict_count,
        warning,
    })
}

/// Copy every conflict file from the folder into the app-private `dir` so the
/// existing conflict UI can surface them. Returns how many were mirrored. Shared
/// by `pull_in` (routine sync) and `switch_to_remote` (data-source change).
fn mirror_conflict_files(backend: &dyn SafBackend, dir: &Path) -> Result<usize> {
    let mut count = 0usize;
    for name in backend.list_file_names()? {
        if is_conflict_filename(&name, BASE_STEM, BASE_FILENAME) {
            if let Ok(bytes) = backend.read_file(&name) {
                let _ = std::fs::write(dir.join(&name), bytes);
                count += 1;
            }
        }
    }
    Ok(count)
}

fn mirror_local_attachment_files(backend: &dyn SafBackend, data_path: &Path) -> Result<()> {
    let dir = data_path.parent().unwrap_or_else(|| Path::new("."));
    if !dir.exists() {
        return Ok(());
    }
    let remote_names = backend.list_file_names().unwrap_or_default();
    for relative in local_attachment_rel_paths(dir)? {
        let abs = dir.join(Path::new(&relative));
        let bytes = std::fs::read(&abs)?;
        let should_write = match backend.read_file(&relative) {
            Ok(remote) => sha256(&remote) != sha256(&bytes),
            Err(_) => !remote_names.iter().any(|n| n == &relative),
        };
        if should_write {
            backend.write_file(&relative, &bytes)?;
        }
    }
    Ok(())
}

fn mirror_remote_attachment_files(backend: &dyn SafBackend, dir: &Path) -> Result<bool> {
    let mut imported = false;
    for name in backend.list_file_names()? {
        if !is_attachment_filename(&name) {
            continue;
        }
        if let Ok(bytes) = backend.read_file(&name) {
            let path = dir.join(Path::new(&name));
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let changed = std::fs::read(&path)
                .map(|local| sha256(&local) != sha256(&bytes))
                .unwrap_or(true);
            if changed {
                std::fs::write(path, bytes)?;
                imported = true;
            }
        }
    }
    Ok(imported)
}

/// Collect relative attachment paths: legacy flat files and one level of
/// `attachments_*/attachment_*`.
fn local_attachment_rel_paths(dir: &Path) -> Result<Vec<String>> {
    crate::commands::list_managed_attachment_rels(dir)
}

fn own_history_filename(data_path: &Path) -> Option<String> {
    history::history_path(data_path)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| is_history_sidecar_filename(n))
        .map(|n| n.to_string())
}

/// Push this device's history sidecar. Peer `history_<other>.jsonl` files stay
/// owned by those devices — writing them from here would clobber a newer remote.
fn mirror_local_history_file(backend: &dyn SafBackend, data_path: &Path) -> Result<()> {
    let Some(name) = own_history_filename(data_path) else {
        return Ok(());
    };
    let path = history::history_path(data_path);
    if !path.exists() {
        return Ok(());
    }
    let bytes = std::fs::read(&path)?;
    let should_write = match backend.read_file(&name) {
        Ok(remote) => sha256(&remote) != sha256(&bytes),
        Err(_) => true,
    };
    if should_write {
        backend.write_file(&name, &bytes)?;
    }
    Ok(())
}

/// Pull history sidecars from the SAF folder.
///
/// `adopt_own`: routine pull keeps a present own sidecar (local appends win until
/// the next push). Folder-switch adopts the new folder as source of truth: copy
/// the remote own sidecar if it exists, otherwise delete the local one so the
/// next push does not publish history from the discarded document.
fn mirror_remote_history_files(
    backend: &dyn SafBackend,
    data_path: &Path,
    adopt_own: bool,
) -> Result<bool> {
    let dir = data_path.parent().unwrap_or_else(|| Path::new("."));
    let own = own_history_filename(data_path);
    let mut imported = false;
    let mut saw_own = false;
    for name in backend.list_file_names()? {
        if !is_history_sidecar_filename(&name) {
            continue;
        }
        let dest = dir.join(&name);
        let is_own = own.as_deref() == Some(name.as_str());
        if is_own {
            saw_own = true;
            if !adopt_own && dest.exists() {
                continue;
            }
        }
        if let Ok(bytes) = backend.read_file(&name) {
            let changed = std::fs::read(&dest)
                .map(|local| sha256(&local) != sha256(&bytes))
                .unwrap_or(true);
            if changed {
                std::fs::write(&dest, bytes)?;
                imported = true;
            }
        }
    }
    if adopt_own {
        if let Some(own_name) = &own {
            let dest = dir.join(own_name);
            if dest.exists() && !saw_own {
                let _ = std::fs::remove_file(&dest);
                imported = true;
            }
        }
    }
    Ok(imported)
}

/// Switch the master to the folder's replicas, **discarding** the current
/// local in-memory document (no conflict file). For the explicit "change data
/// source" action, where the user wants the new folder's data loaded outright.
/// The remote is read and validated before anything is replaced, so local data is
/// only dropped once the new data is successfully loaded; remote conflict files
/// are still mirrored so they stay visible.
pub fn switch_to_remote(
    state: &AppState,
    backend: &dyn SafBackend,
    data_path: &Path,
) -> Result<PullOutcome> {
    let dir = data_path.parent().unwrap_or_else(|| Path::new("."));
    let conflict_count = mirror_conflict_files(backend, dir)?;
    let attachments_imported = mirror_remote_attachment_files(backend, dir)?;
    let history_imported = mirror_remote_history_files(backend, data_path, true)?;
    // The explicit folder-switch loads the remote outright; skipped replicas are
    // already logged in read_merged_remote.
    let (imported, new_synced_hash) = match read_merged_remote(backend)?.0 {
        Some(remote) => (true, Some(state.load_replacing_local(remote)?)),
        None => (false, None),
    };
    // Same as pull_in: blobs the switched-to document doesn't reference must not
    // linger locally, or the next push re-uploads them into the new folder.
    crate::commands::gc_unreferenced_attachment_blobs(state);
    Ok(PullOutcome {
        imported: imported || attachments_imported || history_imported,
        new_synced_hash,
        conflict_count,
        warning: None,
    })
}

/// Returns the merged remote document (if any) plus the names of any replicas that
/// were skipped because they couldn't be read or parsed, so the caller can
/// surface degraded sync rather than silently dropping a device's data.
fn read_merged_remote(backend: &dyn SafBackend) -> Result<(Option<Document>, Vec<String>)> {
    let names = backend.list_file_names()?;
    let replica_names = pick_replica_names(&names);
    let mut docs = Vec::new();
    let mut skipped = Vec::new();
    if replica_names.is_empty() {
        // Legacy single-file folder: prefer tasks.db, then tasks.json.
        if names.iter().any(|n| n == "tasks.db") {
            match backend.read_file("tasks.db") {
                Ok(bytes) => match decode_replica_bytes("tasks.db", &bytes) {
                    Ok(doc) => docs.push(doc),
                    Err(e) => {
                        eprintln!("saf: skipping unparseable tasks.db: {e}");
                        skipped.push("tasks.db".into());
                    }
                },
                Err(e) => {
                    eprintln!("saf: skipping unreadable tasks.db: {e}");
                    skipped.push("tasks.db".into());
                }
            }
        } else if let Some(bytes) = backend.read_tasks()? {
            match crate::store::parse_checked(&bytes) {
                Ok(doc) => docs.push(doc),
                Err(e) => {
                    eprintln!("saf: skipping unparseable tasks.json: {e}");
                    skipped.push(BASE_FILENAME.into());
                }
            }
        }
    } else {
        for name in replica_names {
            // Skip a replica that can't be read or parsed (a not-yet-materialized
            // cloud file, or a torn mid-sync write) and merge the healthy rest,
            // rather than letting one bad replica sink the whole pull — but record
            // it so the skip is surfaced, not silent.
            match backend.read_file(&name) {
                Ok(bytes) => match decode_replica_bytes(&name, &bytes) {
                    Ok(doc) => docs.push(doc),
                    Err(e) => {
                        eprintln!("saf: skipping unparseable replica {name}: {e}");
                        skipped.push(name);
                    }
                },
                Err(e) => {
                    eprintln!("saf: skipping unreadable replica {name}: {e}");
                    skipped.push(name);
                }
            }
        }
    }
    if docs.is_empty() {
        return Ok((None, skipped));
    }
    Ok((Some(merge_documents(docs)), skipped))
}

/// Status surfaced to the UI.
#[derive(Debug, Clone, Serialize)]
pub struct SyncStatus {
    pub linked: bool,
    pub folder_label: Option<String>,
    pub permission_ok: bool,
    pub last_synced_ms: Option<i64>,
    pub last_error: Option<String>,
    pub conflict_count: usize,
}

impl SyncStatus {
    /// The status when no folder is linked. Also the value the non-Android stub
    /// sync commands return so the command names resolve on desktop.
    pub fn unlinked() -> Self {
        Self {
            linked: false,
            folder_label: None,
            permission_ok: false,
            last_synced_ms: None,
            last_error: None,
            conflict_count: 0,
        }
    }
}

/// Device-local sidecar (app-private, NEVER synced) recording the picked folder.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncConfig {
    /// `FileUri::to_json_string()` output; `None` = not linked.
    pub folder_uri_json: Option<String>,
    pub folder_label: Option<String>,
    /// Hash of the last document synced (pushed or pulled). Persisted so a cold
    /// start doesn't treat the unchanged local doc as "never synced" and clobber
    /// a remote another device updated while this app was closed (#Phase 4B).
    #[serde(default)]
    pub last_synced_hash: Option<[u8; 32]>,
}

pub fn sidecar_path(data_path: &Path) -> PathBuf {
    data_path.with_file_name("sync.json")
}

pub fn load_config(data_path: &Path) -> SyncConfig {
    std::fs::read(sidecar_path(data_path))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save_config(data_path: &Path, cfg: &SyncConfig) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(cfg)?;
    std::fs::write(sidecar_path(data_path), bytes)?;
    Ok(())
}

/// Managed runtime state (one per app).
#[derive(Default)]
pub struct SafSync {
    pub inner: Mutex<SafSyncInner>,
}

#[derive(Default)]
pub struct SafSyncInner {
    pub folder_uri_json: Option<String>,
    pub folder_label: Option<String>,
    pub permission_ok: bool,
    pub last_synced_hash: Option<[u8; 32]>,
    pub last_synced_ms: Option<i64>,
    pub last_error: Option<String>,
}

impl SafSync {
    pub fn status(&self, conflict_count: usize) -> SyncStatus {
        let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        SyncStatus {
            linked: g.folder_uri_json.is_some(),
            folder_label: g.folder_label.clone(),
            permission_ok: g.permission_ok,
            last_synced_ms: g.last_synced_ms,
            last_error: g.last_error.clone(),
            conflict_count,
        }
    }
}

#[cfg(target_os = "android")]
pub mod android {
    use super::*;
    use crate::commands::is_attachments_subdir;
    use tauri::AppHandle;
    use tauri_plugin_android_fs::{AndroidFsExt, Entry, FileUri, UriPermission};

    fn saferr(e: impl std::fmt::Display) -> crate::error::AppError {
        crate::error::AppError::Invalid(format!("saf: {e}"))
    }

    /// Real SAF backend bound to a picked folder URI.
    pub struct AndroidSafBackend<'a> {
        pub app: &'a AppHandle,
        pub folder: FileUri,
    }

    impl<'a> AndroidSafBackend<'a> {
        pub fn from_json(app: &'a AppHandle, folder_uri_json: &str) -> Result<Self> {
            let folder = FileUri::from_json_str(folder_uri_json).map_err(saferr)?;
            Ok(Self { app, folder })
        }
    }

    impl<'a> SafBackend for AndroidSafBackend<'a> {
        fn read_tasks(&self) -> Result<Option<Vec<u8>>> {
            let fs = self.app.android_fs();
            // Decide existence by enumeration (reliable across SAF providers,
            // including Google Drive) rather than by path resolution, then only
            // treat a true absence as `None`. A file that exists but can't be
            // read (e.g. a Drive file not yet materialized) must surface as an
            // error, never as "no remote" — collapsing that to `None` is what let
            // a transient failure overwrite an existing remote.
            let present = fs
                .read_dir(&self.folder)
                .map_err(saferr)?
                .into_iter()
                .any(|e| matches!(e, Entry::File { name, .. } if name == BASE_FILENAME));
            if !present {
                return Ok(None);
            }
            let uri = fs
                .resolve_file_uri(&self.folder, BASE_FILENAME)
                .map_err(saferr)?;
            Ok(Some(fs.read(&uri).map_err(saferr)?))
        }
        fn write_file(&self, name: &str, bytes: &[u8]) -> Result<()> {
            let fs = self.app.android_fs();
            let uri = match fs.resolve_file_uri(&self.folder, name) {
                Ok(u) => u,
                Err(_) => {
                    // create_new_file creates parent dirs for nested paths like
                    // `attachments_dev/attachment_….bin`.
                    fs.create_new_file(&self.folder, name, mime_for_name(name))
                        .map_err(saferr)?
                }
            };
            fs.write(&uri, bytes).map_err(saferr)
        }
        fn list_file_names(&self) -> Result<Vec<String>> {
            let fs = self.app.android_fs();
            let entries = fs.read_dir(&self.folder).map_err(saferr)?;
            let mut names = Vec::new();
            for e in entries {
                match e {
                    Entry::File { name, .. } => names.push(name),
                    Entry::Dir { name, uri, .. } if is_attachments_subdir(&name) => {
                        let inner = fs.read_dir(&uri).map_err(saferr)?;
                        for child in inner {
                            if let Entry::File { name: file, .. } = child {
                                names.push(format!("{name}/{file}"));
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(names)
        }
        fn read_file(&self, name: &str) -> Result<Vec<u8>> {
            let fs = self.app.android_fs();
            let uri = fs.resolve_file_uri(&self.folder, name).map_err(saferr)?;
            fs.read(&uri).map_err(saferr)
        }
        fn delete_file(&self, name: &str) -> Result<()> {
            let fs = self.app.android_fs();
            if let Ok(uri) = fs.resolve_file_uri(&self.folder, name) {
                let _ = fs.remove_file(&uri);
            }
            Ok(())
        }
    }

    /// Open the system folder picker (async) and persist read+write permission.
    /// Returns the picked folder's `to_json_string()` + a display label.
    pub async fn pick_and_persist(app: &AppHandle) -> Result<Option<(String, String)>> {
        let api = app.android_fs_async();
        let picked = api
            .file_picker()
            .pick_dir(None, false)
            .await
            .map_err(saferr)?;
        let Some(uri) = picked else { return Ok(None) };
        api.file_picker()
            .persist_uri_permission(&uri)
            .await
            .map_err(saferr)?;
        let json = uri.to_json_string().map_err(saferr)?;
        let label = folder_label(&uri);
        Ok(Some((json, label)))
    }

    /// Best-effort human label from the tree URI's last path segment.
    pub fn folder_label(uri: &FileUri) -> String {
        let raw = uri.uri.rsplit('/').next().unwrap_or(&uri.uri);
        // Decode the few characters that matter for display.
        raw.replace("%2F", "/")
            .replace("%3A", ":")
            .replace("%20", " ")
    }

    /// Check the persisted read+write permission still holds.
    pub fn permission_ok(app: &AppHandle, folder_uri_json: &str) -> bool {
        let Ok(uri) = FileUri::from_json_str(folder_uri_json) else {
            return false;
        };
        app.android_fs()
            .file_picker()
            .check_persisted_uri_permission(&uri, UriPermission::ReadAndWrite)
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::AppState;
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// In-memory SafBackend for tests.
    #[derive(Default)]
    struct FakeBackend {
        files: Mutex<HashMap<String, Vec<u8>>>,
    }
    impl FakeBackend {
        fn with(files: &[(&str, &[u8])]) -> Self {
            let m = files
                .iter()
                .map(|(n, b)| (n.to_string(), b.to_vec()))
                .collect();
            FakeBackend {
                files: Mutex::new(m),
            }
        }
    }
    impl SafBackend for FakeBackend {
        fn read_tasks(&self) -> crate::error::Result<Option<Vec<u8>>> {
            Ok(self.files.lock().unwrap().get("tasks.json").cloned())
        }
        fn write_file(&self, name: &str, bytes: &[u8]) -> crate::error::Result<()> {
            self.files
                .lock()
                .unwrap()
                .insert(name.into(), bytes.to_vec());
            Ok(())
        }
        fn list_file_names(&self) -> crate::error::Result<Vec<String>> {
            Ok(self.files.lock().unwrap().keys().cloned().collect())
        }
        fn read_file(&self, name: &str) -> crate::error::Result<Vec<u8>> {
            self.files
                .lock()
                .unwrap()
                .get(name)
                .cloned()
                .ok_or_else(|| crate::error::AppError::NotFound(name.into()))
        }
        fn delete_file(&self, name: &str) -> crate::error::Result<()> {
            self.files.lock().unwrap().remove(name);
            Ok(())
        }
    }

    /// A backend whose folder listing fails — models a SAF/Google Drive provider
    /// that errors (or is momentarily unreachable) when we probe the folder. Used
    /// to prove the link decision is fail-safe under uncertainty.
    struct UnreadableBackend;
    impl SafBackend for UnreadableBackend {
        fn read_tasks(&self) -> crate::error::Result<Option<Vec<u8>>> {
            Err(crate::error::AppError::Invalid("saf: read failed".into()))
        }
        fn write_file(&self, _name: &str, _bytes: &[u8]) -> crate::error::Result<()> {
            panic!("write_file must never be called when the folder state is unknown");
        }
        fn list_file_names(&self) -> crate::error::Result<Vec<String>> {
            Err(crate::error::AppError::Invalid("saf: list failed".into()))
        }
        fn read_file(&self, name: &str) -> crate::error::Result<Vec<u8>> {
            Err(crate::error::AppError::NotFound(name.into()))
        }
        fn delete_file(&self, _name: &str) -> crate::error::Result<()> {
            Ok(())
        }
    }

    fn temp_state() -> (tempfile::TempDir, AppState, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tasks_android.db");
        let state = AppState::open(path.clone()).unwrap();
        (dir, state, path)
    }

    fn write_peer_db(doc: &Document) -> Vec<u8> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("peer.db");
        let mut conn = crate::db::open(&path).unwrap();
        crate::db::write_document(&mut conn, doc).unwrap();
        drop(conn);
        std::fs::read(&path).unwrap()
    }

    #[test]
    fn remote_has_tasks_detects_presence_via_enumeration() {
        let present = FakeBackend::with(&[("tasks.json", b"{\"tasks\":[],\"tags\":[]}")]);
        assert_eq!(remote_has_tasks(&present).unwrap(), true);

        let present_db = FakeBackend::with(&[("tasks_peer.db", b"not-a-real-db-but-name-counts")]);
        assert_eq!(remote_has_tasks(&present_db).unwrap(), true);

        let absent = FakeBackend::with(&[("notes.txt", b"x")]);
        assert_eq!(remote_has_tasks(&absent).unwrap(), false);
    }

    #[test]
    fn remote_has_tasks_propagates_listing_errors() {
        // A folder we can't read must NOT look empty — the error has to surface.
        assert!(remote_has_tasks(&UnreadableBackend).is_err());
    }

    #[test]
    fn first_link_pulls_when_remote_present() {
        let backend = FakeBackend::with(&[("tasks.json", b"{\"tasks\":[],\"tags\":[]}")]);
        assert_eq!(first_link_action(&backend), LinkAction::Pull);
    }

    #[test]
    fn first_link_seeds_only_when_folder_confirmed_empty() {
        let backend = FakeBackend::default();
        assert_eq!(first_link_action(&backend), LinkAction::Seed);
    }

    #[test]
    fn switch_to_remote_discards_local_and_loads_remote() {
        let (_d, state, path) = temp_state();
        // Local has un-synced data. The OLD pull behavior preserved it as a
        // conflict file; switching the data source must DISCARD it instead.
        state
            .write(|d| {
                d.tags.push(crate::model::Tag {
                    id: "g_local".into(),
                    name: "local".into(),
                    color: "#fff".into(),
                    priority: 0,
                    pinned: false,
                    updated_at: 1,
                    dashboard_view: None,
                });
                Ok(())
            })
            .unwrap();

        // The new folder holds a different document — this is what should load.
        let mut remote_doc = crate::model::Document::default();
        remote_doc.tags.push(crate::model::Tag {
            id: "g_remote".into(),
            name: "remote".into(),
            color: "#fff".into(),
            priority: 0,
            pinned: false,
            updated_at: 1,
            dashboard_view: None,
        });
        let remote = write_peer_db(&remote_doc);
        let backend = FakeBackend::with(&[("tasks_peer.db", &remote)]);

        let out = switch_to_remote(&state, &backend, &path).unwrap();
        assert!(out.imported);
        // Remote loaded outright.
        assert_eq!(
            state.read(|d| d.tags.iter().map(|t| t.id.clone()).collect::<Vec<_>>()),
            ["g_remote"]
        );
        // Local discarded — no conflict file (unlike routine pull_in).
        assert!(
            crate::sync::scan_conflict_files(&path).is_empty(),
            "switching data source discards local without a conflict file"
        );
    }

    #[test]
    fn switch_to_remote_adopts_own_history_from_folder() {
        let (dir, state, path) = temp_state();
        std::fs::write(dir.path().join("history_android.jsonl"), b"{\"event\":\"discarded\"}\n")
            .unwrap();
        let mut remote_doc = crate::model::Document::default();
        remote_doc.tags.push(crate::model::Tag {
            id: "g_remote".into(),
            name: "remote".into(),
            color: "#fff".into(),
            priority: 0,
            pinned: false,
            updated_at: 1,
            dashboard_view: None,
        });
        let remote = write_peer_db(&remote_doc);
        let backend = FakeBackend::with(&[
            ("tasks_peer.db", remote.as_slice()),
            ("history_android.jsonl", b"{\"event\":\"from-folder\"}\n".as_slice()),
        ]);
        switch_to_remote(&state, &backend, &path).unwrap();
        assert_eq!(
            std::fs::read(dir.path().join("history_android.jsonl")).unwrap(),
            b"{\"event\":\"from-folder\"}\n"
        );
    }

    #[test]
    fn switch_to_remote_drops_own_history_absent_from_folder() {
        let (dir, state, path) = temp_state();
        std::fs::write(dir.path().join("history_android.jsonl"), b"{\"event\":\"discarded\"}\n")
            .unwrap();
        let mut remote_doc = crate::model::Document::default();
        remote_doc.tags.push(crate::model::Tag {
            id: "g_remote".into(),
            name: "remote".into(),
            color: "#fff".into(),
            priority: 0,
            pinned: false,
            updated_at: 1,
            dashboard_view: None,
        });
        let remote = write_peer_db(&remote_doc);
        let backend = FakeBackend::with(&[("tasks_peer.db", remote.as_slice())]);
        switch_to_remote(&state, &backend, &path).unwrap();
        assert!(
            !dir.path().join("history_android.jsonl").exists(),
            "switch must drop own history the new folder does not contain"
        );
        push_out(&state, &backend, &path, None).unwrap();
        assert!(
            !backend
                .files
                .lock()
                .unwrap()
                .contains_key("history_android.jsonl"),
            "next push must not republish discarded-document history"
        );
    }

    #[test]
    fn first_link_aborts_rather_than_seed_when_state_unknown() {
        // The regression guard for the Google Drive data-loss bug: when we can't
        // tell whether the folder already holds a tasks.json, we must NOT seed
        // (which would overwrite the remote). Abort and surface the error instead.
        assert_eq!(first_link_action(&UnreadableBackend), LinkAction::Abort);
    }

    #[test]
    fn is_conflict_filename_matches_sync_conflict_copies() {
        assert!(is_conflict_filename(
            "tasks.sync-conflict-20260530-120000-ABCDEF.json",
            "tasks",
            "tasks.json"
        ));
        assert!(!is_conflict_filename("tasks.json", "tasks", "tasks.json")); // the main file
        assert!(!is_conflict_filename("notes.json", "tasks", "tasks.json")); // wrong stem
        assert!(!is_conflict_filename(
            "tasks.backup.json",
            "tasks",
            "tasks.json"
        )); // no "conflict"
    }

    #[test]
    fn push_out_writes_then_suppresses_identical() {
        let (_d, state, path) = temp_state();
        let backend = FakeBackend::default();
        // First push writes and returns a hash.
        let h1 = push_out(&state, &backend, &path, None).unwrap();
        assert!(h1.is_some());
        assert!(backend
            .files
            .lock()
            .unwrap()
            .contains_key("tasks_android.db"));
        // Second push with the same last_synced_hash is suppressed (no new hash).
        let h2 = push_out(&state, &backend, &path, h1).unwrap();
        assert!(h2.is_none());
    }

    #[test]
    fn pull_in_imports_changed_remote_and_skips_unchanged() {
        let (_d, state, path) = temp_state();
        // Build "remote" bytes = current doc with an extra tag, so import is observable.
        let mut remote_doc = state.read(|d| d.clone());
        remote_doc.tags.push(crate::model::Tag {
            id: "g_remote".into(),
            name: "remote".into(),
            color: "#fff".into(),
            priority: 0,
            pinned: false,
            updated_at: 1,
            dashboard_view: None,
        });
        let remote = write_peer_db(&remote_doc);
        let backend = FakeBackend::with(&[("tasks_peer.db", &remote)]);

        let out = pull_in(&state, &backend, &path, None).unwrap();
        assert!(out.imported);
        assert_eq!(
            state.read(|d| d.tags.iter().map(|t| t.id.clone()).collect::<Vec<_>>()),
            ["g_remote"]
        );
        let h = out.new_synced_hash;

        // Pulling again with the same hash imports nothing.
        let out2 = pull_in(&state, &backend, &path, h).unwrap();
        assert!(!out2.imported);
    }

    #[test]
    fn pull_in_merges_diverged_local_with_remote_without_conflict() {
        let (_d, state, path) = temp_state();
        // Local has un-synced data that must not be discarded or stashed.
        state
            .write(|d| {
                d.tags.push(crate::model::Tag {
                    id: "g_local".into(),
                    name: "local".into(),
                    color: "#fff".into(),
                    priority: 0,
                    pinned: false,
                    updated_at: 1,
                    dashboard_view: None,
                });
                Ok(())
            })
            .unwrap();

        // Remote holds a different document (a different tag).
        let mut remote_doc = crate::model::Document::default();
        remote_doc.tags.push(crate::model::Tag {
            id: "g_remote".into(),
            name: "remote".into(),
            color: "#fff".into(),
            priority: 0,
            pinned: false,
            updated_at: 1,
            dashboard_view: None,
        });
        let remote = write_peer_db(&remote_doc);
        let backend = FakeBackend::with(&[("tasks_peer.db", &remote)]);

        // First link (last_synced_hash = None): merge remote into local.
        let out = pull_in(&state, &backend, &path, None).unwrap();
        assert!(out.imported);
        let mut ids = state.read(|d| d.tags.iter().map(|t| t.id.clone()).collect::<Vec<_>>());
        ids.sort();
        assert_eq!(
            ids,
            ["g_local", "g_remote"],
            "local and remote must LWW-merge like desktop"
        );

        // No conflict-local file — same policy as desktop peer merge.
        assert!(
            crate::sync::scan_conflict_files(&path).is_empty(),
            "diverged local+remote must not create conflict-local"
        );
    }

    #[test]
    fn pull_in_adopts_cleanly_when_local_matches_last_synced() {
        let (_d, state, path) = temp_state();
        // Seed local with data and treat it as already-synced (content hash).
        state
            .write(|d| {
                d.tags.push(crate::model::Tag {
                    id: "g".into(),
                    name: "t".into(),
                    color: "#fff".into(),
                    priority: 0,
                    pinned: false,
                    updated_at: 1,
                    dashboard_view: None,
                });
                Ok(())
            })
            .unwrap();
        let synced_hash = state.read(|d| content_hash(d));

        // Remote moved ahead (another device); this device has NO un-synced edits.
        let mut remote_doc = state.read(|d| d.clone());
        remote_doc.tags.push(crate::model::Tag {
            id: "g_remote".into(),
            name: "remote".into(),
            color: "#fff".into(),
            priority: 0,
            pinned: false,
            updated_at: 1,
            dashboard_view: None,
        });
        let remote = write_peer_db(&remote_doc);
        let backend = FakeBackend::with(&[("tasks_peer.db", &remote)]);

        let out = pull_in(&state, &backend, &path, Some(synced_hash)).unwrap();
        assert!(out.imported);
        assert!(
            state.read(|d| d.tags.iter().any(|t| t.id == "g_remote")),
            "remote edit adopted"
        );
        // No spurious conflict file: local was merely behind, not diverged.
        assert!(
            crate::sync::scan_conflict_files(&path).is_empty(),
            "a device that is only behind must merge without a conflict file"
        );
    }

    #[test]
    fn pull_in_does_not_reimport_when_only_local_diverged_after_merge() {
        // After merging local+remote, last_synced tracks the *remote* hash.
        // A second pull with unchanged remotes must not re-import every poll
        // just because the local master now differs from the remote-only merge.
        let (_d, state, path) = temp_state();
        state
            .write(|d| {
                d.tags.push(crate::model::Tag {
                    id: "g_local".into(),
                    name: "local".into(),
                    color: "#fff".into(),
                    priority: 0,
                    pinned: false,
                    updated_at: 1,
                    dashboard_view: None,
                });
                Ok(())
            })
            .unwrap();

        let mut remote_doc = crate::model::Document::default();
        remote_doc.tags.push(crate::model::Tag {
            id: "g_remote".into(),
            name: "remote".into(),
            color: "#fff".into(),
            priority: 0,
            pinned: false,
            updated_at: 1,
            dashboard_view: None,
        });
        let remote = write_peer_db(&remote_doc);
        let backend = FakeBackend::with(&[("tasks_peer.db", &remote)]);

        let out = pull_in(&state, &backend, &path, None).unwrap();
        assert!(out.imported);
        let h = out.new_synced_hash;
        assert!(h.is_some());

        let out2 = pull_in(&state, &backend, &path, h).unwrap();
        assert!(
            !out2.imported,
            "unchanged remote must not re-trigger import after a local+remote merge"
        );
    }

    #[test]
    fn pull_in_mirrors_conflict_files_and_ignores_garbage_tasks() {
        let (_d, state, path) = temp_state();
        let before = state.read(|d| d.clone());
        let conflict_bytes = serde_json::to_vec_pretty(&before).unwrap();
        let backend = FakeBackend::with(&[
            ("tasks_peer.db", b"not a sqlite database at all"),
            (
                "tasks.sync-conflict-20260530-120000-AAA.json",
                &conflict_bytes,
            ),
            ("unrelated.txt", b"ignore me"),
        ]);

        // Garbage replica must NOT clobber the shadow, and must NOT abort the
        // pull: the conflict mirror already done this pass has to survive.
        let out = pull_in(&state, &backend, &path, None).expect("pull is non-fatal on bad remote");
        assert!(out.warning.is_some(), "invalid remote surfaces a non-fatal warning");
        assert_eq!(out.conflict_count, 1, "the conflict file was still mirrored");
        assert_eq!(
            state.read(|d| (d.tasks.len(), d.tags.len())),
            (before.tasks.len(), before.tags.len())
        );

        // The conflict file must have been mirrored into the app-private dir.
        let mirrored = path.with_file_name("tasks.sync-conflict-20260530-120000-AAA.json");
        assert!(mirrored.exists());
    }

    #[test]
    fn pull_skips_a_bad_replica_and_warns_but_imports_the_good_one() {
        let (_d, state, path) = temp_state();
        let mut good = Document::default();
        good.tags.push(crate::model::Tag {
            id: "t_1".into(),
            name: "work".into(),
            color: "#000".into(),
            priority: 0,
            pinned: false,
            updated_at: 1,
            dashboard_view: None,
        });
        let good_bytes = write_peer_db(&good);
        let backend = FakeBackend::with(&[
            ("tasks_good.db", &good_bytes),
            ("tasks_bad.db", b"not a sqlite database"),
        ]);

        let out = pull_in(&state, &backend, &path, None).expect("pull is non-fatal");
        assert!(
            out.warning.as_deref().unwrap_or("").contains("tasks_bad.db"),
            "the skipped replica is surfaced as a warning, got {:?}",
            out.warning
        );
        assert!(out.imported, "the healthy replica was still imported");
        assert_eq!(state.read(|d| d.tags.len()), 1, "good replica's tag merged in");
    }

    #[test]
    fn pull_merges_legacy_json_peer_when_no_db() {
        let (_d, state, path) = temp_state();
        let mut good = Document::default();
        good.tags.push(crate::model::Tag {
            id: "t_json".into(),
            name: "legacy".into(),
            color: "#000".into(),
            priority: 0,
            pinned: false,
            updated_at: 1,
            dashboard_view: None,
        });
        let good_bytes = serde_json::to_vec_pretty(&good).unwrap();
        let backend = FakeBackend::with(&[("tasks_legacy.json", &good_bytes)]);

        let out = pull_in(&state, &backend, &path, None).unwrap();
        assert!(out.imported);
        assert_eq!(
            state.read(|d| d.tags[0].id.clone()),
            "t_json"
        );
    }

    /// A task whose single attachment blob lives at `rel`.
    fn task_with_attachment(rel: &str) -> crate::model::Task {
        crate::model::Task {
            id: "k_att".into(),
            title: "with attachment".into(),
            due_date: None,
            due_time: None,
            start_date: None,
            start_time: None,
            notes: String::new(),
            attachments: vec![crate::model::Attachment {
                id: "a_1".into(),
                name: "photo.bin".into(),
                path: rel.into(),
                mime_type: None,
                size: Some(10),
                // Millisecond stamps that stay ordered after iso_secs truncates to
                // whole seconds on a SQLite round-trip (SAF peer .db path).
                created_at: 1_700_000_000_000,
            }],
            tag_ids: Vec::new(),
            estimated_seconds: None,
            created_at: 1_700_000_000_000,
            completed_at: None,
            updated_at: 1_700_000_000_000,
            time_entries: Vec::new(),
        }
    }

    #[test]
    fn push_and_pull_mirror_attachment_subdirectories() {
        let (dir, state, path) = temp_state();
        let sub = dir.path().join("attachments_android");
        std::fs::create_dir_all(&sub).unwrap();
        let rel = "attachments_android/attachment_a_photo.bin";
        std::fs::write(dir.path().join(rel), b"blob-bytes").unwrap();
        // The blob must be referenced by the document, or the pull-side GC
        // (correctly) treats it as an orphan and removes it.
        state
            .write(|d| {
                d.tasks.push(task_with_attachment(rel));
                Ok(())
            })
            .unwrap();

        let backend = FakeBackend::default();
        let h = push_out(&state, &backend, &path, None).unwrap();
        assert!(h.is_some());
        assert_eq!(
            backend.files.lock().unwrap().get(rel).map(|b| b.as_slice()),
            Some(b"blob-bytes".as_slice())
        );

        // Pull into a fresh local folder.
        let dir2 = tempfile::tempdir().unwrap();
        let path2 = dir2.path().join("tasks_phone.db");
        let state2 = AppState::open(path2.clone()).unwrap();
        let out = pull_in(&state2, &backend, &path2, None).unwrap();
        assert!(out.imported);
        assert_eq!(
            std::fs::read(dir2.path().join(rel)).unwrap(),
            b"blob-bytes"
        );
    }

    #[test]
    fn pull_gcs_tombstoned_blob_so_push_cannot_resurrect_it() {
        // Device A removed an attachment: the remote replica carries the
        // tombstone and A's GC already deleted the blob from the synced folder.
        // This device still holds the blob locally; after pulling the tombstone
        // the blob must be GC'd here too — otherwise the next push's attachment
        // mirror re-uploads the file A just deleted (the resurrection bug).
        let (dir, state, path) = temp_state();
        let rel = "attachments_android/attachment_a_photo.bin";
        std::fs::create_dir_all(dir.path().join("attachments_android")).unwrap();
        std::fs::write(dir.path().join(rel), b"blob-bytes").unwrap();
        state
            .write(|d| {
                d.tasks.push(task_with_attachment(rel));
                Ok(())
            })
            .unwrap();
        let synced_hash = state.read(|d| content_hash(d));

        // Remote: same task, attachment removed + tombstoned, newer edit.
        let mut remote_doc = state.read(|d| d.clone());
        remote_doc.tasks[0].attachments.clear();
        remote_doc.tasks[0].updated_at = 1_700_000_010_000;
        remote_doc.deleted_attachments.push(crate::model::Tombstone {
            id: "a_1".into(),
            deleted_at: 1_700_000_010_000,
            deleted_by: None,
        });
        let remote = write_peer_db(&remote_doc);
        let backend = FakeBackend::with(&[("tasks_peer.db", &remote)]);

        let out = pull_in(&state, &backend, &path, Some(synced_hash)).unwrap();
        assert!(out.imported);
        assert!(
            !dir.path().join(rel).exists(),
            "tombstoned blob must be GC'd from the local mirror"
        );

        // The follow-up push must not re-upload the deleted blob.
        push_out(&state, &backend, &path, out.new_synced_hash).unwrap();
        assert!(
            !backend.files.lock().unwrap().contains_key(rel),
            "push must not resurrect a blob the remote deleted"
        );
    }

    #[test]
    fn push_out_writes_own_history_sidecar_even_when_doc_unchanged() {
        let (dir, state, path) = temp_state();
        state
            .write(|d| {
                d.tags.push(crate::model::Tag {
                    id: "g".into(),
                    name: "t".into(),
                    color: "#fff".into(),
                    priority: 0,
                    pinned: false,
                    updated_at: 1,
                    dashboard_view: None,
                });
                Ok(())
            })
            .unwrap();
        let local_history = std::fs::read(dir.path().join("history_android.jsonl")).unwrap();
        assert!(!local_history.is_empty());

        let backend = FakeBackend::default();
        let h = push_out(&state, &backend, &path, None).unwrap();
        assert!(h.is_some());
        assert_eq!(
            backend
                .files
                .lock()
                .unwrap()
                .get("history_android.jsonl")
                .map(|b| b.as_slice()),
            Some(local_history.as_slice())
        );

        // A later local append must still reach the folder even if the document
        // hash has not changed since the last push (hash-suppressed db write).
        std::fs::write(dir.path().join("history_android.jsonl"), b"{\"event\":\"later\"}\n").unwrap();
        let h2 = push_out(&state, &backend, &path, h).unwrap();
        assert!(h2.is_none());
        assert_eq!(
            backend
                .files
                .lock()
                .unwrap()
                .get("history_android.jsonl")
                .map(|b| b.as_slice()),
            Some(b"{\"event\":\"later\"}\n".as_slice())
        );
        assert!(
            !backend.files.lock().unwrap().contains_key("history_peer.jsonl"),
            "push must not publish a peer sidecar sitting locally"
        );
    }

    #[test]
    fn push_out_does_not_upload_peer_history_sidecars() {
        let (dir, state, path) = temp_state();
        std::fs::write(dir.path().join("history_peer.jsonl"), b"{\"event\":\"peer\"}\n").unwrap();
        let backend = FakeBackend::default();
        push_out(&state, &backend, &path, None).unwrap();
        assert!(!backend.files.lock().unwrap().contains_key("history_peer.jsonl"));
        assert!(!backend.files.lock().unwrap().contains_key("history.jsonl"));
    }

    #[test]
    fn pull_in_mirrors_peer_history_and_skips_bare_legacy() {
        let (dir, state, path) = temp_state();
        let own = b"{\"event\":\"local-own\"}\n";
        std::fs::write(dir.path().join("history_android.jsonl"), own).unwrap();

        let backend = FakeBackend::with(&[
            ("history_desktop.jsonl", b"{\"event\":\"peer\"}\n".as_slice()),
            ("history_android.jsonl", b"{\"event\":\"stale-own\"}\n".as_slice()),
            ("history.jsonl", b"{\"event\":\"legacy\"}\n".as_slice()),
        ]);
        let out = pull_in(&state, &backend, &path, None).unwrap();
        assert!(out.imported);
        assert_eq!(
            std::fs::read(dir.path().join("history_desktop.jsonl")).unwrap(),
            b"{\"event\":\"peer\"}\n"
        );
        assert_eq!(
            std::fs::read(dir.path().join("history_android.jsonl")).unwrap(),
            own,
            "local own sidecar must not be overwritten by a stale remote copy"
        );
        assert!(
            !dir.path().join("history.jsonl").exists(),
            "bare history.jsonl is not a per-device sidecar"
        );
    }

    #[test]
    fn pull_in_fills_missing_own_history_from_remote() {
        let (dir, state, path) = temp_state();
        assert!(!dir.path().join("history_android.jsonl").exists());
        let backend = FakeBackend::with(&[(
            "history_android.jsonl",
            b"{\"event\":\"from-folder\"}\n".as_slice(),
        )]);
        let out = pull_in(&state, &backend, &path, None).unwrap();
        assert!(out.imported);
        assert_eq!(
            std::fs::read(dir.path().join("history_android.jsonl")).unwrap(),
            b"{\"event\":\"from-folder\"}\n"
        );
    }

    #[test]
    fn pull_in_makes_peer_history_readable_like_the_history_view() {
        // Desktop already published a valid sidecar in the shared folder.
        let desktop_dir = tempfile::tempdir().unwrap();
        let desktop_data = desktop_dir.path().join("tasks_desktop.db");
        crate::history::append_history(
            &desktop_data,
            &[crate::history::HistoryEntry {
                timestamp: 1_700_000_000_000,
                event: "task.created".into(),
                entity: "task".into(),
                entity_id: "k_desktop".into(),
                title: "From desktop".into(),
                summary: "Created task".into(),
                device_id: Some("desktop".into()),
                device_name: Some("PC".into()),
                dedup_key: Some("task.created|task|k_desktop|1700000000000".into()),
            }],
        )
        .unwrap();
        let desktop_bytes = std::fs::read(desktop_dir.path().join("history_desktop.jsonl")).unwrap();

        let (_dir, state, path) = temp_state();
        let backend = FakeBackend::with(&[("history_desktop.jsonl", desktop_bytes.as_slice())]);
        let out = pull_in(&state, &backend, &path, None).unwrap();
        assert!(out.imported);

        let titles: Vec<String> = crate::history::read_all_history(&path)
            .unwrap()
            .into_iter()
            .map(|e| e.title)
            .collect();
        assert!(
            titles.iter().any(|t| t == "From desktop"),
            "History view must include the peer sidecar after pull, got {titles:?}"
        );
    }

    #[test]
    fn two_device_push_then_pull_round_trips_history() {
        // Device A (android) records an edit and publishes to the shared folder.
        let (_dir_a, state_a, path_a) = temp_state();
        state_a
            .write(|d| {
                d.tags.push(crate::model::Tag {
                    id: "g_shared".into(),
                    name: "shared-tag".into(),
                    color: "#fff".into(),
                    priority: 0,
                    pinned: false,
                    updated_at: 1,
                    dashboard_view: None,
                });
                Ok(())
            })
            .unwrap();
        let backend = FakeBackend::default();
        push_out(&state_a, &backend, &path_a, None).unwrap();
        assert!(backend
            .files
            .lock()
            .unwrap()
            .contains_key("history_android.jsonl"));

        // Device B (phone) pulls that folder and must see A's history entries.
        let dir_b = tempfile::tempdir().unwrap();
        let path_b = dir_b.path().join("tasks_phone.db");
        let state_b = AppState::open(path_b.clone()).unwrap();
        let out = pull_in(&state_b, &backend, &path_b, None).unwrap();
        assert!(out.imported);
        assert!(
            dir_b.path().join("history_android.jsonl").exists(),
            "pull must copy the pusher's sidecar into the peer's data folder"
        );
        let titles: Vec<String> = crate::history::read_all_history(&path_b)
            .unwrap()
            .into_iter()
            .map(|e| e.title)
            .collect();
        assert!(
            titles.iter().any(|t| t == "#shared-tag"),
            "peer device must read the pusher's history sidecar, got {titles:?}"
        );
    }
}
