# Pansutong Phase 4B — Android Folder Sync (SAF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Android, let the user point Pansutong at a Syncthing-managed folder so tasks sync across devices, keeping the app-private `tasks.json` as the crash-safe master and mirroring it (plus conflict files) to/from the picked folder.

**Architecture:** App-private `tasks.json` stays the master (`store.rs`/`sync.rs`/`conflict.rs` unchanged). A new `safsync` module mirrors files between the app-private dir and a user-picked SAF folder via the community crate `tauri-plugin-android-fs` (v28). The SAF I/O sits behind a `SafBackend` trait so the mirror logic is unit-tested on desktop with a fake; the real backend is Android-only. Push-out is frontend-triggered (debounced) on each local change; pull-in runs on launch, on every foreground, and on a manual "Sync now". Hash loop-suppression prevents echo. Conflict files from the folder are mirrored into the app-private dir so the **existing** conflict UI works on Android unchanged.

**Tech Stack:** Tauri 2, `tauri-plugin-android-fs` v28 (Rust + its `@tauri-apps`-style JS not used — we use custom commands), React 19 + TypeScript, `@tauri-apps/plugin-os` for Android detection.

---

## Deviation from the spec (intentional, with rationale)

The spec said to store the picked `content://` tree URI in `settings.data_file`. **We do NOT.** `settings` is part of the synced `tasks.json`, so a device-specific URI stored there would propagate to other devices and clobber their config. Instead the URI is stored in a **device-local sidecar** `app_data_dir()/sync.json` that is **never** synced. Everything else follows the approved spec.

## Context (verified current signatures)

- `store.rs` `AppState` (all **pub**): `read<F,T>(&self, f: FnOnce(&Document)->T) -> T`, `write<F,T>(&self, f: FnOnce(&mut Document)->Result<T>) -> Result<T>` (atomic write + updates `last_written_hash`), `reload_from_bytes(&self, Vec<u8>) -> Result<()>`, `path(&self) -> PathBuf`, `last_written_hash(&self) -> [u8;32]`, `AppState::open(path: PathBuf) -> Result<AppState>`. `atomic_write`/`sha256` are private.
- `commands.rs`: `const STORE_CHANGED: &str = "store-changed";`, `fn emit_changed(app: &AppHandle)` (private — emit `store-changed` directly via `app.emit`). Conflict commands derive their scan dir from `state.path()`. `resolve_conflict`/`dismiss_conflict` delete the **local** conflict file by `conflict_path` and re-emit `conflicts-detected`.
- `sync.rs`: `pub fn start(app, data_path)`, watcher is **not** cfg-gated. `scan_conflict_files` is **private** (used by `list_conflicts`); matching = filename `!= base`, `starts_with(stem)`, `ends_with(".json")`, `contains("conflict")`.
- `conflict.rs` (**pub**): `diff_tasks(&Document,&Document)->Vec<TaskDiff>`, `apply_decisions(&Document,&Document,&[Decision])->Vec<Task>`.
- `model.rs`: `Settings { data_file: Option<String>, theme: String, device_id: String }`. `Document { version, settings, projects, tags, tasks }` (Clone + serde).
- `error.rs`: `enum AppError { Io(io::Error), Serde(serde_json::Error), NotFound(String), Invalid(String) }`, `type Result<T>`. Map SAF errors to `AppError::Invalid(format!("saf: {e}"))`.
- `lib.rs` `run()`: builder adds `tauri_plugin_opener`, `tauri_plugin_os`, conditionally `tauri_plugin_global_shortcut` (`#[cfg(desktop)]`), then `.setup(...)` (opens `AppState` from `app_data_dir()/tasks.json`, starts watcher, desktop quick-capture window) then `generate_handler![... 19 commands ...]`.
- Frontend: `src/lib/tauri.ts` `api` object (no sync methods yet; `invoke` from `@tauri-apps/api/core`); `Settings` type. `src/state/store.ts` `useDocument` listens to `store-changed` (no visibility handling). `src/views/SettingsView.tsx` has a read-only "Data file" section + theme buttons calling `api.updateSettings`. `@tauri-apps/plugin-os` is installed but unused. `listen` from `@tauri-apps/api/event`.

### tauri-plugin-android-fs v28.1.0 API (used below)

- `tauri-plugin-android-fs = "28"` (default feature `commands`; minSdk 24; needs Tauri ≥2.8.2 — we are on 2.11.x).
- Register: `.plugin(tauri_plugin_android_fs::init())`.
- `use tauri_plugin_android_fs::{AndroidFsExt, Entry, FileUri, UriPermission};` then `app.android_fs()` (sync) / `app.android_fs_async()` (async).
- Picker: `app.android_fs_async().file_picker().pick_dir(None, false).await -> Result<Option<FileUri>>` (async — opens a system picker).
- Permissions (on `file_picker()`): `persist_uri_permission(&FileUri)`, `check_persisted_uri_permission(&FileUri, UriPermission::ReadAndWrite) -> Result<bool>`, `release_persisted_uri_permission(&FileUri)`.
- I/O (on `android_fs()`): `read(&FileUri)->Result<Vec<u8>>`, `write(&FileUri, &[u8])->Result<()>` (safe `"wt"` truncate), `read_dir(&FileUri)->Result<Vec<Entry>>` (`Entry::File{uri,name,len,last_modified,mime_type}` | `Entry::Dir{...}`), `create_new_file(&dir, relpath, mime: Option<&str>)->Result<FileUri>`, `resolve_file_uri(&dir, relpath)->Result<FileUri>`, `remove_file(&FileUri)->Result<()>`.
- `FileUri { uri: String, document_top_tree_uri: Option<String> }`, `to_json_string()->Result<String>`, `from_json_str(&str)->Result<Self>`. Serde-serializable.
- **Note:** this is a single-maintainer crate; the exact method names/async-ness are from v28.1.0 docs. The Android backend (Task 3) is verified by `cargo check --target …-linux-android`; if a signature differs at the pinned version, follow the compiler and adjust minimally — the intent per method is stated in comments.

### Android-target verification needs env

Android-only Rust (`#[cfg(target_os="android")]`) compiles only for an Android target. Verify with `cargo check --target x86_64-linux-android`. The env vars are persisted at User scope but may not be ambient in a fresh shell — rehydrate first (PowerShell):

```pwsh
$env:JAVA_HOME    = [Environment]::GetEnvironmentVariable('JAVA_HOME','User')
$env:ANDROID_HOME = [Environment]::GetEnvironmentVariable('ANDROID_HOME','User')
$env:NDK_HOME     = [Environment]::GetEnvironmentVariable('NDK_HOME','User')
$env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')
```

If the Android toolchain is unavailable in the execution environment, mark the Android-target check **SKIPPED** and rely on the desktop build staying green + the Task 6 on-device smoke test. Desktop `cargo check`/`cargo test` must always pass (the new Android code is `#[cfg]`-excluded from desktop).

---

## Files this plan creates or modifies

| Path | Action | Responsibility |
|---|---|---|
| `src-tauri/Cargo.toml` | Modify | Add `tauri-plugin-android-fs = "28"` under `[target.'cfg(target_os="android")'.dependencies]` |
| `src-tauri/src/safsync.rs` | Create | `SafBackend` trait, `SyncStatus`/`SyncConfig`, sidecar load/save, `is_conflict_filename`, `push_out`/`pull_in` mirror logic, `SafSync` managed state, fake-backed unit tests; Android backend impl gated inside |
| `src-tauri/src/lib.rs` | Modify | Register the plugin + manage `SafSync` + startup link-restore (all `#[cfg(target_os="android")]`); add new commands to `generate_handler!` |
| `src-tauri/src/commands.rs` | Modify | New cfg-gated commands; Android conflict-file deletion hook in `resolve_conflict`/`dismiss_conflict` |
| `src/lib/tauri.ts` | Modify | `SyncStatus` type + `pickSyncFolder`/`clearSyncFolder`/`syncNow`/`getSyncStatus` wrappers |
| `src/lib/platform.ts` | Create | `isAndroid()` via `@tauri-apps/plugin-os` (cached) |
| `src/views/SettingsView.tsx` | Modify | Android-only "Sync folder" card |
| `src/state/store.ts` | Modify | On Android: `sync_now` on launch + on `visibilitychange`→visible; debounced `sync_push` on `store-changed` |

---

## Task 1 — Add the plugin dependency + register it (Android only)

**Files:** `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`

- [ ] **Step 1.1: Add the dependency**

In `src-tauri/Cargo.toml`, add a new target section after the existing global-shortcut one:

```toml
[target.'cfg(target_os = "android")'.dependencies]
tauri-plugin-android-fs = "28"
```

- [ ] **Step 1.2: Register the plugin (Android only) in `lib.rs`**

In `run()`, after the `#[cfg(desktop)]` global-shortcut `let builder = ...` block and before `builder.setup(...)`, add:

```rust
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_android_fs::init());
```

- [ ] **Step 1.3: Verify**

Desktop (must pass): `cargo check --manifest-path src-tauri/Cargo.toml` ; `cargo test --manifest-path src-tauri/Cargo.toml` (44 tests) ; `npx tsc --noEmit`.
Android (rehydrate env first — see header): `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-linux-android` (downloads the crate; clean). If env unavailable, mark SKIPPED.

- [ ] **Step 1.4: Commit**

```
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "Add tauri-plugin-android-fs (Android-only) + register plugin"
```

---

## Task 2 — `safsync` core: trait, mirror logic, sidecar, managed state (TDD)

All code in this task is **platform-neutral** (compiles + tests on desktop). The Android backend is added in Task 3.

**Files:** Create `src-tauri/src/safsync.rs`; modify `src-tauri/src/lib.rs` (add `mod safsync;`).

- [ ] **Step 2.1: Declare the module**

In `src-tauri/src/lib.rs`, add `mod safsync;` alongside the other `mod` declarations (e.g. after `mod sync;`).

- [ ] **Step 2.2: Write the failing tests**

Create `src-tauri/src/safsync.rs` with ONLY the tests first (they won't compile yet — that's the failing state):

```rust
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
        // Build "remote" bytes = current doc with theme flipped, so import is observable.
        let mut remote_doc = state.read(|d| d.clone());
        remote_doc.settings.theme = "dark".to_string();
        let remote = serde_json::to_vec_pretty(&remote_doc).unwrap();
        let backend = FakeBackend::with(&[("tasks.json", &remote)]);

        let out = pull_in(&state, &backend, &path, None).unwrap();
        assert!(out.imported);
        assert_eq!(state.read(|d| d.settings.theme.clone()), "dark");
        let h = out.new_synced_hash;

        // Pulling again with the same hash imports nothing.
        let out2 = pull_in(&state, &backend, &path, h).unwrap();
        assert!(!out2.imported);
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
        assert_eq!(state.read(|d| d.settings.theme.clone()), before.settings.theme);

        // The conflict file must have been mirrored into the app-private dir.
        let mirrored = path.with_file_name("tasks.sync-conflict-20260530-120000-AAA.json");
        assert!(mirrored.exists());
    }
}
```

Note: `pull_in_mirrors_conflict_files_and_ignores_garbage_tasks` exercises the order-independence requirement that a garbage main file does not prevent conflict mirroring. Implement `pull_in` (Step 2.4) to **mirror conflict files even if the main-file import fails** (mirror first, then attempt the main import, or collect the main-import error without returning early). Adjust the test if you choose to return the parse error — but the shadow-unchanged + conflict-mirrored assertions must hold.

- [ ] **Step 2.3: Run tests to confirm they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml safsync`
Expected: FAIL to compile (`SafBackend`, `push_out`, etc. not defined).

- [ ] **Step 2.4: Implement the core (above the `tests` module)**

Put this at the **top** of `src-tauri/src/safsync.rs`:

```rust
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
    let bytes = state.read(|d| serde_json::to_vec_pretty(d))?;
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

    // 2. Adopt a changed, VALID remote tasks.json (last-write-wins).
    let mut new_hash = last_synced_hash;
    let mut imported = false;
    if let Some(remote) = backend.read_tasks()? {
        let h = sha256(&remote);
        if Some(h) != last_synced_hash {
            match serde_json::from_slice::<crate::model::Document>(&remote) {
                Ok(doc) => {
                    state.write(|d| {
                        *d = doc;
                        Ok(())
                    })?;
                    new_hash = Some(h);
                    imported = true;
                }
                Err(_) => {
                    // Torn/garbage remote: skip, keep the shadow intact.
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

/// Device-local sidecar (app-private, NEVER synced) recording the picked folder.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncConfig {
    /// `FileUri::to_json_string()` output; `None` = not linked.
    pub folder_uri_json: Option<String>,
    pub folder_label: Option<String>,
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
```

- [ ] **Step 2.5: Run tests to confirm they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml safsync`
Expected: PASS (4 new tests). Then `cargo test --manifest-path src-tauri/Cargo.toml` → 48 tests pass; `npx tsc --noEmit` clean.

- [ ] **Step 2.6: Commit**

```
git add src-tauri/src/safsync.rs src-tauri/src/lib.rs
git commit -m "Add safsync core: SafBackend trait + mirror logic + sidecar (tested)"
```

---

## Task 3 — Android `SafBackend` implementation

**Files:** Modify `src-tauri/src/safsync.rs` (add an Android-gated `android` submodule).

- [ ] **Step 3.1: Add the Android backend**

Append to `src-tauri/src/safsync.rs` (before the `#[cfg(test)] mod tests`):

```rust
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
```

- [ ] **Step 3.2: Verify the Android build compiles**

Rehydrate env (see header), then:

```
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-linux-android
```

Expected: clean. Desktop unaffected: `cargo check --manifest-path src-tauri/Cargo.toml` clean; `cargo test --manifest-path src-tauri/Cargo.toml` 48 pass. If the plugin's method signatures differ at v28.x, follow the compiler and adjust minimally (intent is in the comments). If the Android toolchain is unavailable, mark this SKIPPED and proceed (Task 6 verifies on-device).

- [ ] **Step 3.3: Commit**

```
git add src-tauri/src/safsync.rs
git commit -m "Add Android SafBackend impl over tauri-plugin-android-fs"
```

---

## Task 4 — Commands + startup wiring + conflict-file deletion

**Files:** `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`.

- [ ] **Step 4.1: Add the sync commands (Android-gated) to `commands.rs`**

Add near the other commands (use the existing imports for `State`, `AppHandle`, `AppError`; add `use tauri::Emitter;` if `app.emit` is not already in scope — check existing `emit_changed`):

```rust
#[cfg(target_os = "android")]
fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[cfg(target_os = "android")]
fn run_pull(app: &AppHandle, state: &AppState, saf: &crate::safsync::SafSync) -> crate::safsync::SyncStatus {
    use crate::safsync::{self, android::AndroidSafBackend};
    let path = state.path();
    let (folder_json, last_hash) = {
        let g = saf.inner.lock().unwrap();
        (g.folder_uri_json.clone(), g.last_synced_hash)
    };
    let mut conflicts = 0usize;
    if let Some(json) = folder_json {
        match AndroidSafBackend::from_json(app, &json) {
            Ok(backend) => match safsync::pull_in(state, &backend, &path, last_hash) {
                Ok(out) => {
                    let mut g = saf.inner.lock().unwrap();
                    g.last_synced_hash = out.new_synced_hash;
                    g.last_synced_ms = Some(now_ms());
                    g.last_error = None;
                    conflicts = out.conflict_count;
                    drop(g);
                    if out.imported {
                        let _ = app.emit(STORE_CHANGED, ());
                    }
                    let _ = app.emit("conflicts-detected", &list_conflicts_inner(&path));
                }
                Err(e) => { saf.inner.lock().unwrap().last_error = Some(e.to_string()); }
            },
            Err(e) => { saf.inner.lock().unwrap().last_error = Some(e.to_string()); }
        }
    }
    saf.status(conflicts)
}

#[cfg(target_os = "android")]
fn run_push(app: &AppHandle, state: &AppState, saf: &crate::safsync::SafSync) -> crate::safsync::SyncStatus {
    use crate::safsync::{self, android::AndroidSafBackend};
    let (folder_json, last_hash) = {
        let g = saf.inner.lock().unwrap();
        (g.folder_uri_json.clone(), g.last_synced_hash)
    };
    if let Some(json) = folder_json {
        match AndroidSafBackend::from_json(app, &json) {
            Ok(backend) => match safsync::push_out(state, &backend, last_hash) {
                Ok(Some(h)) => {
                    let mut g = saf.inner.lock().unwrap();
                    g.last_synced_hash = Some(h);
                    g.last_synced_ms = Some(now_ms());
                    g.last_error = None;
                }
                Ok(None) => {}
                Err(e) => { saf.inner.lock().unwrap().last_error = Some(e.to_string()); }
            },
            Err(e) => { saf.inner.lock().unwrap().last_error = Some(e.to_string()); }
        }
    }
    saf.status(count_conflicts(&state.path()))
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn pick_sync_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    saf: State<'_, crate::safsync::SafSync>,
) -> Result<crate::safsync::SyncStatus> {
    use crate::safsync;
    let picked = safsync::android::pick_and_persist(&app).await?;
    if let Some((json, label)) = picked {
        {
            let mut g = saf.inner.lock().unwrap();
            g.folder_uri_json = Some(json.clone());
            g.folder_label = Some(label.clone());
            g.permission_ok = true;
            g.last_synced_hash = None; // force a real sync on first link
            g.last_error = None;
        }
        safsync::save_config(&state.path(), &safsync::SyncConfig {
            folder_uri_json: Some(json),
            folder_label: Some(label),
        })?;
        // First link: pull if remote exists, else push to seed.
        let backend_has_remote = {
            let g = saf.inner.lock().unwrap();
            g.folder_uri_json.clone()
        }.and_then(|j| safsync::android::AndroidSafBackend::from_json(&app, &j).ok())
         .and_then(|b| b.read_tasks().ok().flatten()).is_some();
        if backend_has_remote {
            return Ok(run_pull(&app, &state, &saf));
        } else {
            return Ok(run_push(&app, &state, &saf));
        }
    }
    Ok(saf.status(count_conflicts(&state.path())))
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn clear_sync_folder(
    state: State<'_, AppState>,
    saf: State<'_, crate::safsync::SafSync>,
) -> Result<()> {
    {
        let mut g = saf.inner.lock().unwrap();
        g.folder_uri_json = None;
        g.folder_label = None;
        g.permission_ok = false;
        g.last_synced_hash = None;
        g.last_error = None;
    }
    crate::safsync::save_config(&state.path(), &crate::safsync::SyncConfig::default())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn sync_push(
    app: AppHandle,
    state: State<'_, AppState>,
    saf: State<'_, crate::safsync::SafSync>,
) -> crate::safsync::SyncStatus {
    run_push(&app, &state, &saf)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn sync_now(
    app: AppHandle,
    state: State<'_, AppState>,
    saf: State<'_, crate::safsync::SafSync>,
) -> crate::safsync::SyncStatus {
    let _ = run_push(&app, &state, &saf); // push-then-pull
    run_pull(&app, &state, &saf)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn get_sync_status(
    state: State<'_, AppState>,
    saf: State<'_, crate::safsync::SafSync>,
) -> crate::safsync::SyncStatus {
    saf.status(count_conflicts(&state.path()))
}
```

- [ ] **Step 4.2: Make the conflict scanner reusable**

In `src-tauri/src/sync.rs`, change `fn scan_conflict_files` to `pub fn scan_conflict_files` (it is currently private). In `src-tauri/src/commands.rs`, add two small helpers used above (place near the conflict commands):

```rust
fn list_conflicts_inner(path: &std::path::Path) -> Vec<String> {
    crate::sync::scan_conflict_files(path)
}
fn count_conflicts(path: &std::path::Path) -> usize {
    crate::sync::scan_conflict_files(path).len()
}
```

If `list_conflicts` already calls `scan_conflict_files` directly, refactor it to call `list_conflicts_inner(&state.path())` so there's one path (optional but DRY).

- [ ] **Step 4.3: Delete the SAF-side conflict file on resolve/dismiss (Android)**

In `resolve_conflict` and `dismiss_conflict` in `commands.rs`, **after** the existing `std::fs::remove_file(<local conflict_path>)`, add the Android-side deletion so a resolved conflict doesn't re-mirror on the next pull:

```rust
    #[cfg(target_os = "android")]
    {
        if let Some(name) = std::path::Path::new(&CONFLICT_PATH_VAR)
            .file_name().and_then(|s| s.to_str())
        {
            let saf = app.state::<crate::safsync::SafSync>();
            let folder_json = saf.inner.lock().unwrap().folder_uri_json.clone();
            if let Some(json) = folder_json {
                if let Ok(backend) = crate::safsync::android::AndroidSafBackend::from_json(&app, &json) {
                    let _ = backend.delete_file(name);
                }
            }
        }
    }
```

Replace `CONFLICT_PATH_VAR` with the actual variable name in each command (`input.conflict_path` in `resolve_conflict`; `conflict_path` in `dismiss_conflict`). This needs `use tauri::Manager;` in scope for `app.state::<_>()` (already used elsewhere) and the commands already take `app: AppHandle`.

- [ ] **Step 4.4: Register commands + manage state + restore link in `lib.rs`**

In `run()`'s `.setup(...)`, after `app.manage(state);` and the watcher start, add:

```rust
            #[cfg(target_os = "android")]
            {
                use crate::safsync::{SafSync, load_config};
                let cfg = load_config(&app.path().app_data_dir().unwrap().join("tasks.json"));
                let saf = SafSync::default();
                if let Some(json) = cfg.folder_uri_json.clone() {
                    let ok = crate::safsync::android::permission_ok(&app.handle(), &json);
                    let mut g = saf.inner.lock().unwrap();
                    g.folder_uri_json = Some(json);
                    g.folder_label = cfg.folder_label.clone();
                    g.permission_ok = ok;
                }
                app.manage(saf);
            }
```

Add the new commands to the `generate_handler!` list. Because Tauri's `generate_handler!` macro can't contain `#[cfg]` lines mid-list cleanly, append them on Android by keeping the existing list and adding a parallel block is not supported — instead, add the five commands to the **single** `generate_handler!` and gate each command's *definition* (already done with `#[cfg(target_os="android")]` on the `pub fn`). On desktop the referenced names won't exist, which breaks the macro. To avoid that, define **desktop no-op stubs** for the same names in `commands.rs`:

```rust
#[cfg(not(target_os = "android"))]
pub mod sync_stubs {
    use super::*;
    #[tauri::command] pub fn pick_sync_folder() -> crate::safsync::SyncStatus { crate::safsync::SyncStatus { linked:false, folder_label:None, permission_ok:false, last_synced_ms:None, last_error:None, conflict_count:0 } }
    #[tauri::command] pub fn clear_sync_folder() -> Result<()> { Ok(()) }
    #[tauri::command] pub fn sync_push() -> crate::safsync::SyncStatus { pick_sync_folder() }
    #[tauri::command] pub fn sync_now() -> crate::safsync::SyncStatus { pick_sync_folder() }
    #[tauri::command] pub fn get_sync_status() -> crate::safsync::SyncStatus { pick_sync_folder() }
}
```

and in `generate_handler!` reference them conditionally by using two `cfg`-gated `use` aliases at the top of `lib.rs`:

```rust
#[cfg(target_os = "android")]
use commands::{pick_sync_folder, clear_sync_folder, sync_push, sync_now, get_sync_status};
#[cfg(not(target_os = "android"))]
use commands::sync_stubs::{pick_sync_folder, clear_sync_folder, sync_push, sync_now, get_sync_status};
```

then list the bare names `pick_sync_folder, clear_sync_folder, sync_push, sync_now, get_sync_status` in `generate_handler!`. (The `SyncStatus` type is platform-neutral — defined in Task 2 — so the stubs compile on desktop.)

- [ ] **Step 4.5: Verify**

Desktop: `cargo check --manifest-path src-tauri/Cargo.toml` ; `cargo test --manifest-path src-tauri/Cargo.toml` (48 pass) ; `npx tsc --noEmit`.
Android (rehydrate env): `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-linux-android` clean (or SKIPPED).

- [ ] **Step 4.6: Commit**

```
git add src-tauri/src/commands.rs src-tauri/src/sync.rs src-tauri/src/lib.rs
git commit -m "Add sync commands, startup link-restore, and SAF conflict cleanup"
```

---

## Task 5 — Frontend: status type, wrappers, Settings card, triggers

**Files:** `src/lib/tauri.ts`, `src/lib/platform.ts` (create), `src/views/SettingsView.tsx`, `src/state/store.ts`.

- [ ] **Step 5.1: Add the `SyncStatus` type + command wrappers**

In `src/lib/tauri.ts`, add the type (near the other types):

```ts
export type SyncStatus = {
  linked: boolean;
  folder_label: string | null;
  permission_ok: boolean;
  last_synced_ms: number | null;
  last_error: string | null;
  conflict_count: number;
};
```

and add to the `api` object (after `dismissConflict`):

```ts
  pickSyncFolder:  () => invoke<SyncStatus>("pick_sync_folder"),
  clearSyncFolder: () => invoke<void>("clear_sync_folder"),
  syncNow:         () => invoke<SyncStatus>("sync_now"),
  syncPush:        () => invoke<SyncStatus>("sync_push"),
  getSyncStatus:   () => invoke<SyncStatus>("get_sync_status"),
```

- [ ] **Step 5.2: Create `src/lib/platform.ts`**

```ts
import { type } from "@tauri-apps/plugin-os";

let cached: boolean | null = null;

/** True when running on Android. Cached after first call. */
export async function isAndroid(): Promise<boolean> {
  if (cached === null) {
    try {
      cached = (await type()) === "android";
    } catch {
      cached = false;
    }
  }
  return cached;
}
```

- [ ] **Step 5.3: Add the Android-only "Sync folder" card to `SettingsView.tsx`**

Add imports:

```tsx
import { useEffect, useState } from "react";
import { api, SyncStatus } from "../lib/tauri";
import { isAndroid } from "../lib/platform";
```

Inside the component, before `return`:

```tsx
  const [android, setAndroid] = useState(false);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void isAndroid().then(setAndroid);
  }, []);
  useEffect(() => {
    if (android) void api.getSyncStatus().then(setSync).catch(() => {});
  }, [android]);

  const pick = async () => { setBusy(true); try { setSync(await api.pickSyncFolder()); } finally { setBusy(false); } };
  const now  = async () => { setBusy(true); try { setSync(await api.syncNow()); } finally { setBusy(false); } };
  const unlink = async () => { await api.clearSyncFolder(); setSync(await api.getSyncStatus()); };
```

Add this section in the JSX (place it right after the Theme `<section>` and before `<ProjectManager .../>`):

```tsx
      {android && (
        <section className="settings-section">
          <h2>Sync folder (Android)</h2>
          {sync?.linked ? (
            <>
              <p className="view-sub">
                Folder: <code>{sync.folder_label ?? "(linked)"}</code>
                {!sync.permission_ok && " — access lost, re-pick"}
              </p>
              <p className="view-sub">
                {sync.last_synced_ms
                  ? `Last synced ${new Date(sync.last_synced_ms).toLocaleTimeString()}`
                  : "Not synced yet"}
                {sync.conflict_count > 0 && ` · ${sync.conflict_count} conflict(s)`}
                {sync.last_error && ` · error: ${sync.last_error}`}
              </p>
              <div className="theme-options">
                <button className="theme-option" disabled={busy} onClick={now}>Sync now</button>
                <button className="theme-option" disabled={busy} onClick={pick}>Change folder</button>
                <button className="theme-option" disabled={busy} onClick={unlink}>Unlink</button>
              </div>
            </>
          ) : (
            <>
              <p className="view-sub">
                Pick a Syncthing-managed folder to sync your tasks across devices.
              </p>
              <button className="theme-option" disabled={busy} onClick={pick}>Pick folder…</button>
            </>
          )}
        </section>
      )}
```

- [ ] **Step 5.4: Wire launch + foreground pull and debounced push in `store.ts`**

In `src/state/store.ts`, add imports:

```ts
import { api } from "../lib/tauri";        // (already imported — keep one)
import { isAndroid } from "../lib/platform";
```

Add a new `useEffect` inside `useDocument` (alongside the existing ones):

```ts
  // Android folder-sync triggers: pull on launch + foreground; debounced push on change.
  useEffect(() => {
    let active = true;
    let pushTimer: ReturnType<typeof setTimeout> | undefined;

    const onChange = () => {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => { void api.syncPush().catch(() => {}); }, 1000);
    };
    const onVisible = () => { if (!document.hidden) void api.syncNow().catch(() => {}); };

    void isAndroid().then((android) => {
      if (!android || !active) return;
      void api.syncNow().catch(() => {});                 // launch pull
      document.addEventListener("visibilitychange", onVisible);
      // push shortly after each local mutation (store-changed already drives reloads)
      void listen("store-changed", onChange).then((un) => { if (!active) un(); });
    });

    return () => {
      active = false;
      clearTimeout(pushTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
```

(`listen` is already imported in `store.ts`. The debounced `syncPush` is hash-suppressed in Rust, so the post-pull `store-changed` echo writes nothing to the folder.)

- [ ] **Step 5.5: Verify**

```
npx tsc --noEmit
npm test
npm run build
```

Expected: tsc clean; 25 vitest pass (unchanged); build emits both entries.

- [ ] **Step 5.6: Commit**

```
git add src/lib/tauri.ts src/lib/platform.ts src/views/SettingsView.tsx src/state/store.ts
git commit -m "Frontend: Android sync-folder Settings card + launch/foreground/push triggers"
```

---

## Task 6 — On-device smoke test (Android)

**Files:** none (verification only). Requires a device/emulator + a shared folder (ideally Syncthing-managed; otherwise any folder you can also write to from a file manager).

- [ ] **Step 6.1: Build + install + launch** (rehydrate env first)

```
npx tauri android build --debug --apk --target x86_64
```

Install the APK on the running emulator/device and launch (per Phase 4 notes: `adb install -r <apk>`; `adb shell am start -n net.puetsua.pansutong/.MainActivity`).

- [ ] **Step 6.2: Link a folder**

Settings → "Sync folder (Android)" → **Pick folder…** → choose a folder. Confirm the card shows the folder label and "Last synced …".

- [ ] **Step 6.3: Push-out**

Add a task on the phone. Within ~1s, confirm `tasks.json` appears/updates in the chosen folder (check via a file manager or the desktop side of Syncthing). 

- [ ] **Step 6.4: Pull-in on foreground**

Edit `tasks.json` in the folder from another device/file-manager (e.g. add a task). Background then foreground the app (or tap **Sync now**). Confirm the new task appears.

- [ ] **Step 6.5: Conflict**

Place a `tasks.sync-conflict-<...>.json` file (a divergent copy) in the folder. Tap **Sync now**. Confirm the conflict surfaces in the existing Conflicts UI, resolve it, and confirm both the local mirror and the folder's conflict file are gone (it does not reappear on the next sync).

- [ ] **Step 6.6: Permission persistence**

Kill and relaunch the app. Confirm the folder is still linked (no re-pick needed) and sync still works.

- [ ] **Step 6.7: No commit** — verification only. If anything fails, STOP and report the exact symptom.

---

## Self-review (checked against the spec)

- App-private master + SAF mirror, no `store.rs`/`sync.rs`/`conflict.rs` rewrite → Tasks 2–4 (only `scan_conflict_files` made `pub`). ✓
- `tauri-plugin-android-fs` pinned + isolated to `safsync.rs` → Tasks 1, 3. ✓
- Auto debounced push-out + pull on launch/foreground/Sync-now; push-then-pull; hash loop-suppression → Tasks 2 (`push_out`/`pull_in` + hashes), 4 (`sync_now`/`sync_push`), 5 (triggers). ✓
- Conflict files mirrored into app-private; existing UI reused; SAF-side deletion on resolve → Tasks 2 (`pull_in` mirroring), 4 (Step 4.3). ✓
- First link adopt-if-present-else-seed → Task 4 (`pick_sync_folder`). ✓
- Folder URI persisted **device-locally** (sidecar) not in synced settings → Task 2 (`SyncConfig`/sidecar), 4 (save/restore). **[spec deviation, documented above]** ✓
- Android-only Settings card; desktop untouched → Task 5 (card gated by `isAndroid()`), desktop command stubs are no-ops. ✓
- Error handling: shadow never clobbered by garbage; permission-loss surfaced → Task 2 (`pull_in` returns error, doesn't write on parse failure), 3 (`permission_ok`), 5 (status display). ✓
- Testing: pure mirror logic unit-tested with a fake; on-device smoke test → Tasks 2, 6. ✓
- minSdk stays 24 (plugin's floor is 24) → header. ✓

## Scope / non-goals (from spec)

In: Android folder pick + persisted permission, bidirectional file mirror (tasks.json + conflict files), auto push-out, pull on launch/foreground/Sync-now, reuse of conflict UI, Android Settings card, hash loop-suppression, permission-loss handling.

Out: any desktop change, timed background polling, sync while app is closed, iOS, desktop data-file-location UI, CRDT.

## Risks / notes for the implementer

- The community crate's exact v28 method names/async-ness are from its docs; the Android-target `cargo check` is the source of truth — adjust minimally if the compiler disagrees, preserving each method's stated intent.
- `generate_handler!` cannot hold `#[cfg]` lines, so desktop **no-op stubs** + `cfg`-gated `use` aliases keep one handler list compiling on both platforms (Step 4.4).
- If `cargo check --target …-linux-android` can't run (no NDK env), the Android code is unverified until the Task 6 build — flag that explicitly rather than claiming green.
