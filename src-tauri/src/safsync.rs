//! Android folder-sync mirror layer.
//!
//! The app-private `tasks.json` remains the crash-safe master (store.rs). This
//! module mirrors it (and Syncthing conflict copies) to/from a user-picked SAF
//! folder. All SAF I/O is hidden behind `SafBackend` so the mirror logic is
//! testable on desktop; the real Android backend lives in the `android` submodule.

use crate::error::{AppError, Result};
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
    /// Remote `tasks.json` bytes, or `None` if it doesn't exist yet.
    fn read_tasks(&self) -> Result<Option<Vec<u8>>>;
    /// Create-or-overwrite the remote `tasks.json`.
    fn write_tasks(&self, bytes: &[u8]) -> Result<()>;
    /// Names of all files directly in the folder.
    fn list_file_names(&self) -> Result<Vec<String>>;
    /// Read a file in the folder by name.
    fn read_file(&self, name: &str) -> Result<Vec<u8>>;
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

/// Push the current document to the folder unless it equals `last_synced_hash`.
/// Returns `Some(new_hash)` if a write happened, `None` if suppressed.
pub fn push_out(
    state: &AppState,
    backend: &dyn SafBackend,
    last_synced_hash: Option<[u8; 32]>,
) -> Result<Option<[u8; 32]>> {
    let bytes = state.read(serde_json::to_vec_pretty)?;
    let h = sha256(&bytes);
    if Some(h) == last_synced_hash {
        return Ok(None);
    }
    backend.write_tasks(&bytes)?;
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
    let mut conflict_count = 0usize;
    for name in backend.list_file_names()? {
        if is_conflict_filename(&name, BASE_STEM, BASE_FILENAME) {
            if let Ok(bytes) = backend.read_file(&name) {
                let _ = std::fs::write(dir.join(&name), bytes);
                conflict_count += 1;
            }
        }
    }

    // 2. Adopt a changed, VALID remote tasks.json (last-write-wins), preserving
    //    any diverged local edits as a conflict file (#34) and writing the remote
    //    bytes verbatim so the synced hash matches what's on disk (no re-push echo).
    let mut new_hash = last_synced_hash;
    let mut imported = false;
    if let Some(remote) = backend.read_tasks()? {
        let h = sha256(&remote);
        if Some(h) != last_synced_hash {
            match state.adopt_synced(&remote, last_synced_hash) {
                Ok(hash) => {
                    new_hash = Some(hash);
                    imported = true;
                }
                Err(_) => {
                    // Torn/garbage or newer-version remote: skip, keep the shadow intact.
                    return Err(AppError::Invalid("saf: remote tasks.json is not valid JSON".into()));
                }
            }
        }
    }

    Ok(PullOutcome { imported, new_synced_hash: new_hash, conflict_count })
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
        let g = self.inner.lock().unwrap();
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
            match fs.resolve_file_uri(&self.folder, BASE_FILENAME) {
                Ok(uri) => match fs.read(&uri) {
                    Ok(b) => Ok(Some(b)),
                    Err(_) => Ok(None),
                },
                Err(_) => Ok(None),
            }
        }
        fn write_tasks(&self, bytes: &[u8]) -> Result<()> {
            let fs = self.app.android_fs();
            let uri = match fs.resolve_file_uri(&self.folder, BASE_FILENAME) {
                Ok(u) => u,
                Err(_) => fs
                    .create_new_file(&self.folder, BASE_FILENAME, Some("application/json"))
                    .map_err(saferr)?,
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
        let picked = api.file_picker().pick_dir(None, false).await.map_err(saferr)?;
        let Some(uri) = picked else { return Ok(None) };
        api.file_picker().persist_uri_permission(&uri).await.map_err(saferr)?;
        let json = uri.to_json_string().map_err(saferr)?;
        let label = folder_label(&uri);
        Ok(Some((json, label)))
    }

    /// Best-effort human label from the tree URI's last path segment.
    pub fn folder_label(uri: &FileUri) -> String {
        let raw = uri.uri.rsplit('/').next().unwrap_or(&uri.uri);
        // Decode the few characters that matter for display.
        raw.replace("%2F", "/").replace("%3A", ":").replace("%20", " ")
    }

    /// Check the persisted read+write permission still holds.
    pub fn permission_ok(app: &AppHandle, folder_uri_json: &str) -> bool {
        let Ok(uri) = FileUri::from_json_str(folder_uri_json) else { return false };
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
            let m = files.iter().map(|(n, b)| (n.to_string(), b.to_vec())).collect();
            FakeBackend { files: Mutex::new(m) }
        }
    }
    impl SafBackend for FakeBackend {
        fn read_tasks(&self) -> crate::error::Result<Option<Vec<u8>>> {
            Ok(self.files.lock().unwrap().get("tasks.json").cloned())
        }
        fn write_tasks(&self, bytes: &[u8]) -> crate::error::Result<()> {
            self.files.lock().unwrap().insert("tasks.json".into(), bytes.to_vec());
            Ok(())
        }
        fn list_file_names(&self) -> crate::error::Result<Vec<String>> {
            Ok(self.files.lock().unwrap().keys().cloned().collect())
        }
        fn read_file(&self, name: &str) -> crate::error::Result<Vec<u8>> {
            self.files.lock().unwrap().get(name).cloned()
                .ok_or_else(|| crate::error::AppError::NotFound(name.into()))
        }
        fn delete_file(&self, name: &str) -> crate::error::Result<()> {
            self.files.lock().unwrap().remove(name);
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
    fn is_conflict_filename_matches_syncthing_copies() {
        assert!(is_conflict_filename(
            "tasks.sync-conflict-20260530-120000-ABCDEF.json", "tasks", "tasks.json"));
        assert!(!is_conflict_filename("tasks.json", "tasks", "tasks.json")); // the main file
        assert!(!is_conflict_filename("notes.json", "tasks", "tasks.json")); // wrong stem
        assert!(!is_conflict_filename("tasks.backup.json", "tasks", "tasks.json")); // no "conflict"
    }

    #[test]
    fn push_out_writes_then_suppresses_identical() {
        let (_d, state, _p) = temp_state();
        let backend = FakeBackend::default();
        // First push writes and returns a hash.
        let h1 = push_out(&state, &backend, None).unwrap();
        assert!(h1.is_some());
        assert!(backend.files.lock().unwrap().contains_key("tasks.json"));
        // Second push with the same last_synced_hash is suppressed (no new hash).
        let h2 = push_out(&state, &backend, h1).unwrap();
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
        });
        let remote = serde_json::to_vec_pretty(&remote_doc).unwrap();
        let backend = FakeBackend::with(&[("tasks.json", &remote)]);

        let out = pull_in(&state, &backend, &path, None).unwrap();
        assert!(out.imported);
        assert_eq!(state.read(|d| d.tags.iter().map(|t| t.id.clone()).collect::<Vec<_>>()), ["g_remote"]);
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
        assert!(state.read(|d| d.tags.is_empty()), "remote (no tags) was adopted");

        // The diverged local doc must survive as a conflict file to reconcile.
        let conflicts = crate::sync::scan_conflict_files(&path);
        assert_eq!(conflicts.len(), 1, "diverged local data preserved as a conflict file");
        let bytes = std::fs::read(&conflicts[0]).unwrap();
        let preserved: crate::model::Document = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(preserved.tags.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["g_local"]);
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
        });
        let remote = serde_json::to_vec_pretty(&remote_doc).unwrap();
        let backend = FakeBackend::with(&[("tasks.json", &remote)]);

        let out = pull_in(&state, &backend, &path, Some(synced_hash)).unwrap();
        assert!(out.imported);
        assert!(state.read(|d| d.tags.iter().any(|t| t.id == "g_remote")), "remote edit adopted");
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
            ("tasks.sync-conflict-20260530-120000-AAA.json", &conflict_bytes),
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
