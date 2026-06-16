//! Android folder-sync mirror layer.
//!
//! The app-private `tasks.json` remains the crash-safe master (store.rs). This
//! module mirrors it (and any sync-tool conflict copies) to/from a user-picked SAF
//! folder. All SAF I/O is hidden behind `SafBackend` so the mirror logic is
//! testable on desktop; the real Android backend lives in the `android` submodule.

use crate::commands::is_attachment_filename;
use crate::error::{AppError, Result};
use crate::model::{merge_documents, Document};
use crate::store::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const BASE_FILENAME: &str = "tasks.json";
const BASE_STEM: &str = "tasks";
const CONFLICT_NEEDLE: &str = "conflict";

/// Abstraction over the picked SAF folder. Implemented for real on Android and
/// with an in-memory fake in tests.
pub trait SafBackend {
    /// Legacy remote `tasks.json` bytes, or `None` if it doesn't exist yet.
    fn read_tasks(&self) -> Result<Option<Vec<u8>>>;
    /// Create-or-overwrite the legacy remote `tasks.json`.
    fn write_tasks(&self, bytes: &[u8]) -> Result<()>;
    /// Names of all files directly in the folder.
    fn list_file_names(&self) -> Result<Vec<String>>;
    /// Read a file in the folder by name.
    fn read_file(&self, name: &str) -> Result<Vec<u8>>;
    /// Create-or-overwrite a file in the folder by name.
    fn write_file(&self, name: &str, bytes: &[u8]) -> Result<()>;
    /// Delete a file in the folder by name (no-op if absent).
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
    name.starts_with("tasks_") && name.ends_with(".json") && !name.contains(CONFLICT_NEEDLE)
}

fn writable_replica_name(data_path: &Path) -> String {
    data_path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|name| is_replica_filename(name))
        .unwrap_or(BASE_FILENAME)
        .to_string()
}

/// What a first link to a picked folder should do, decided **fail-safe**.
#[derive(Debug, PartialEq, Eq)]
pub enum LinkAction {
    /// The folder already holds a `tasks.json` — adopt it (pull). Diverged local
    /// in-memory data is preserved as a conflict file to merge, or discarded
    /// cleanly when it is empty or already matches.
    Pull,
    /// The folder is confirmed to have no `tasks.json` — seed it from the local
    /// document (the only case where writing is safe).
    Seed,
    /// The folder's state could not be determined — do nothing destructive.
    Abort,
}

/// True if the picked folder already contains a `tasks.json`. Uses directory
/// enumeration (`list_file_names`), which works across SAF providers including
/// Google Drive, and **propagates errors** so a caller never mistakes "couldn't
/// read the folder" for "the folder is empty" — the latter is what overwrote a
/// real remote on first link (the Drive data-loss bug).
pub fn remote_has_tasks(backend: &dyn SafBackend) -> Result<bool> {
    Ok(backend
        .list_file_names()?
        .iter()
        .any(|n| n == BASE_FILENAME || is_replica_filename(n)))
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
    let bytes = state.read(serde_json::to_vec_pretty)?;
    let h = sha256(&bytes);
    if Some(h) == last_synced_hash {
        mirror_local_attachment_files(backend, data_path)?;
        return Ok(None);
    }
    backend.write_file(&writable_replica_name(data_path), &bytes)?;
    mirror_local_attachment_files(backend, data_path)?;
    Ok(Some(h))
}

/// Outcome of a pull-in pass.
pub struct PullOutcome {
    pub imported: bool,
    pub new_synced_hash: Option<[u8; 32]>,
    pub conflict_count: usize,
}

/// Mirror the folder into app-private: adopt a changed remote `tasks.json`
/// (last-write-wins) and copy any conflict files into the app-private dir for
/// the existing conflict UI. Never clobbers the shadow with unparseable bytes.
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

    // 2. Adopt a changed, VALID merged remote replica document, preserving any
    //    diverged local edits as a conflict file (#34).
    let mut new_hash = last_synced_hash;
    let mut imported = false;
    if let Some(remote) = read_merged_remote(backend)? {
        let h = sha256(&remote);
        if Some(h) != last_synced_hash {
            match state.adopt_synced(&remote, last_synced_hash) {
                Ok(hash) => {
                    new_hash = Some(hash);
                    imported = true;
                }
                Err(_) => {
                    // Torn/garbage or newer-version remote: skip, keep the shadow intact.
                    return Err(AppError::Invalid(
                        "saf: remote tasks.json is not valid JSON".into(),
                    ));
                }
            }
        }
    }

    Ok(PullOutcome {
        imported: imported || attachments_imported,
        new_synced_hash: new_hash,
        conflict_count,
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
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(|n| n.to_string()) else {
            continue;
        };
        if !is_attachment_filename(&name) {
            continue;
        }
        let bytes = std::fs::read(entry.path())?;
        let should_write = match backend.read_file(&name) {
            Ok(remote) => sha256(&remote) != sha256(&bytes),
            Err(_) => !remote_names.iter().any(|n| n == &name),
        };
        if should_write {
            backend.write_file(&name, &bytes)?;
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
            let path = dir.join(&name);
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

/// Switch the master to the folder's `tasks.json`, **discarding** the current
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
    let (imported, new_synced_hash) = match read_merged_remote(backend)? {
        Some(remote) => (true, Some(state.load_replacing_local(&remote)?)),
        None => (false, None),
    };
    Ok(PullOutcome {
        imported: imported || attachments_imported,
        new_synced_hash,
        conflict_count,
    })
}

fn read_merged_remote(backend: &dyn SafBackend) -> Result<Option<Vec<u8>>> {
    let names = backend.list_file_names()?;
    let replica_names: Vec<_> = names
        .iter()
        .filter(|name| is_replica_filename(name))
        .cloned()
        .collect();
    let mut docs = Vec::new();
    if replica_names.is_empty() {
        if let Some(bytes) = backend.read_tasks()? {
            docs.push(serde_json::from_slice::<Document>(&bytes)?);
        }
    } else {
        for name in replica_names {
            let bytes = backend.read_file(&name)?;
            docs.push(serde_json::from_slice::<Document>(&bytes)?);
        }
    }
    if docs.is_empty() {
        return Ok(None);
    }
    Ok(Some(serde_json::to_vec_pretty(&merge_documents(docs))?))
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
    use tauri::AppHandle;
    use tauri_plugin_android_fs::{AndroidFsExt, Entry, FileUri, UriPermission};

    fn saferr(e: impl std::fmt::Display) -> AppError {
        AppError::Invalid(format!("saf: {e}"))
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
        fn write_tasks(&self, bytes: &[u8]) -> Result<()> {
            self.write_file(BASE_FILENAME, bytes)
        }
        fn write_file(&self, name: &str, bytes: &[u8]) -> Result<()> {
            let fs = self.app.android_fs();
            let uri = match fs.resolve_file_uri(&self.folder, name) {
                Ok(u) => u,
                Err(_) => {
                    let mime = if name.ends_with(".json") {
                        Some("application/json")
                    } else {
                        Some("application/octet-stream")
                    };
                    fs.create_new_file(&self.folder, name, mime)
                        .map_err(saferr)?
                }
            };
            fs.write(&uri, bytes).map_err(saferr)
        }
        fn list_file_names(&self) -> Result<Vec<String>> {
            let fs = self.app.android_fs();
            let entries = fs.read_dir(&self.folder).map_err(saferr)?;
            Ok(entries
                .into_iter()
                .filter_map(|e| match e {
                    Entry::File { name, .. } => Some(name),
                    _ => None,
                })
                .collect())
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
        fn write_tasks(&self, bytes: &[u8]) -> crate::error::Result<()> {
            self.files
                .lock()
                .unwrap()
                .insert("tasks.json".into(), bytes.to_vec());
            Ok(())
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
        fn write_tasks(&self, _bytes: &[u8]) -> crate::error::Result<()> {
            panic!("write_tasks must never be called when the folder state is unknown");
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
        let path = dir.path().join("tasks.json");
        let state = AppState::open(path.clone()).unwrap();
        (dir, state, path)
    }

    #[test]
    fn remote_has_tasks_detects_presence_via_enumeration() {
        let present = FakeBackend::with(&[("tasks.json", b"{\"tasks\":[],\"tags\":[]}")]);
        assert_eq!(remote_has_tasks(&present).unwrap(), true);

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
        });
        let remote = serde_json::to_vec_pretty(&remote_doc).unwrap();
        let backend = FakeBackend::with(&[("tasks.json", &remote)]);

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
        let (_d, state, _p) = temp_state();
        let backend = FakeBackend::default();
        // First push writes and returns a hash.
        let h1 = push_out(
            &state,
            &backend,
            &std::path::PathBuf::from("tasks_android.json"),
            None,
        )
        .unwrap();
        assert!(h1.is_some());
        assert!(backend
            .files
            .lock()
            .unwrap()
            .contains_key("tasks_android.json"));
        // Second push with the same last_synced_hash is suppressed (no new hash).
        let h2 = push_out(
            &state,
            &backend,
            &std::path::PathBuf::from("tasks_android.json"),
            h1,
        )
        .unwrap();
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
        });
        let remote = serde_json::to_vec_pretty(&remote_doc).unwrap();
        let backend = FakeBackend::with(&[("tasks.json", &remote)]);

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
    fn pull_in_preserves_diverged_local_as_conflict() {
        let (_d, state, path) = temp_state();
        // Local has un-synced data (a tag) that a naive adopt would discard.
        state
            .write(|d| {
                d.tags.push(crate::model::Tag {
                    id: "g_local".into(),
                    name: "local".into(),
                    color: "#fff".into(),
                    priority: 0,
                    pinned: false,
                    updated_at: 1,
                });
                Ok(())
            })
            .unwrap();

        // Remote holds a different document (empty, no such tag).
        let remote_doc = crate::model::Document::default();
        let remote = serde_json::to_vec_pretty(&remote_doc).unwrap();
        let backend = FakeBackend::with(&[("tasks.json", &remote)]);

        // First link (last_synced_hash = None): adopt remote, preserve local.
        let out = pull_in(&state, &backend, &path, None).unwrap();
        assert!(out.imported);
        assert!(
            state.read(|d| d.tags.is_empty()),
            "remote (no tags) was adopted"
        );

        // The diverged local doc must survive as a conflict file to reconcile.
        let conflicts = crate::sync::scan_conflict_files(&path);
        assert_eq!(
            conflicts.len(),
            1,
            "diverged local data preserved as a conflict file"
        );
        let bytes = std::fs::read(&conflicts[0]).unwrap();
        let preserved: crate::model::Document = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            preserved
                .tags
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            ["g_local"]
        );
    }

    #[test]
    fn pull_in_adopts_cleanly_when_local_matches_last_synced() {
        let (_d, state, path) = temp_state();
        // Seed local with data and treat it as already-synced (hash of local).
        state
            .write(|d| {
                d.tags.push(crate::model::Tag {
                    id: "g".into(),
                    name: "t".into(),
                    color: "#fff".into(),
                    priority: 0,
                    pinned: false,
                    updated_at: 1,
                });
                Ok(())
            })
            .unwrap();
        let synced_hash = sha256(&state.read(serde_json::to_vec_pretty).unwrap());

        // Remote moved ahead (another device); this device has NO un-synced edits.
        let mut remote_doc = state.read(|d| d.clone());
        remote_doc.tags.push(crate::model::Tag {
            id: "g_remote".into(),
            name: "remote".into(),
            color: "#fff".into(),
            priority: 0,
            pinned: false,
            updated_at: 1,
        });
        let remote = serde_json::to_vec_pretty(&remote_doc).unwrap();
        let backend = FakeBackend::with(&[("tasks.json", &remote)]);

        let out = pull_in(&state, &backend, &path, Some(synced_hash)).unwrap();
        assert!(out.imported);
        assert!(
            state.read(|d| d.tags.iter().any(|t| t.id == "g_remote")),
            "remote edit adopted"
        );
        // No spurious conflict file: local was merely behind, not diverged.
        assert!(
            crate::sync::scan_conflict_files(&path).is_empty(),
            "a device that is only behind must adopt without a conflict file"
        );
    }

    #[test]
    fn pull_in_mirrors_conflict_files_and_ignores_garbage_tasks() {
        let (_d, state, path) = temp_state();
        let before = state.read(|d| d.clone());
        let conflict_bytes = serde_json::to_vec_pretty(&before).unwrap();
        let backend = FakeBackend::with(&[
            ("tasks.json", b"{ this is not valid json"),
            (
                "tasks.sync-conflict-20260530-120000-AAA.json",
                &conflict_bytes,
            ),
            ("unrelated.txt", b"ignore me"),
        ]);

        // Garbage tasks.json must NOT clobber the shadow.
        let result = pull_in(&state, &backend, &path, None);
        // Either it errored on parse OR skipped import; the shadow doc is unchanged either way.
        let _ = result; // parse error is acceptable for the main file
        assert_eq!(
            state.read(|d| (d.tasks.len(), d.tags.len())),
            (before.tasks.len(), before.tags.len())
        );

        // The conflict file must have been mirrored into the app-private dir.
        let mirrored = path.with_file_name("tasks.sync-conflict-20260530-120000-AAA.json");
        assert!(mirrored.exists());
    }
}
